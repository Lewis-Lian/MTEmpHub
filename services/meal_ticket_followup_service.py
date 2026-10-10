"""Project unconsumed follow-up obligations; this module does not write funds."""


def project_pending_amounts(recharge_cents: int, refund_cents: int,
                            offset_enabled: bool) -> list[dict]:
    """Inputs exclude allocated funds and obligations reserved by awaiting tasks.

    Callers establish the baseline and remaining sources, never sum all historical
    adjustments. Output amounts are positive cents, ordered recharge then refund.
    """
    if any(type(amount) is not int or amount < 0 for amount in (recharge_cents, refund_cents)):
        raise ValueError('待办理金额必须为非负整数分')
    if type(offset_enabled) is not bool:
        raise ValueError('抵消开关必须为布尔值')
    if offset_enabled:
        difference = recharge_cents - refund_cents
        recharge_cents, refund_cents = max(difference, 0), max(-difference, 0)
    return [{'kind': kind, 'amount_cents': amount}
            for kind, amount in (('recharge', recharge_cents), ('refund', refund_cents)) if amount]


from copy import deepcopy
from datetime import datetime
from models import db
from models.meal_ticket import (MealTicketBatch, MealTicketItem, MealTicketAdjustment,
                               MealTicketPayment, MealTicketFollowupTask as Task,
                               MealTicketFollowupAllocation as Allocation)
from models.system_setting import SystemSetting
from services.meal_ticket_service import MealError, digest, totals, required_text, batch_for_write


def settings():
    enabled = SystemSetting.get_value('meal_ticket_offset_enabled', 'true') == 'true'
    return enabled, digest({'meal_ticket_offset_enabled': enabled})


def effective_payment(payment):
    if payment.kind not in ('recharge', 'refund'):
        return 0
    reversals = MealTicketPayment.query.filter_by(reversal_of=payment.key).all()
    return abs(payment.amount_cents + sum(p.amount_cents for p in reversals))


def allocated(task):
    return sum(a.amount_cents for a in Allocation.query.filter_by(task_key=task.key).all()
               if effective_payment(MealTicketPayment.query.filter_by(key=a.payment_key).one()))


def derived_status(task):
    value = allocated(task)
    if value == task.amount_cents:
        return 'verified'
    if value and task.status not in ('pending', 'skipped'):
        return 'partial'
    if task.status in ('verified', 'partial'):
        return 'awaiting'
    return task.status


def get_queue(batch):
    enabled, setting_digest = settings()
    state = (batch.followup_state or {}) if batch else {}
    items = {i.key: i for i in MealTicketItem.query.filter_by(batch_key=batch.key).all()} if batch else {}
    tasks = Task.query.filter_by(batch_key=batch.key).all() if batch else []
    tasks.sort(key=lambda t: (t.status == 'skipped', t.skip_order if t.status == 'skipped' else 0,
                             items[t.item_key].dept_name, items[t.item_key].emp_no_snapshot, t.kind))
    result = []
    for task in tasks:
        item, value = items[task.item_key], allocated(task)
        result.append(dict(key=task.key, item_key=item.key, emp_no=item.emp_no_snapshot, name=item.name,
            dept_name=item.dept_name, kind=task.kind, amount_cents=task.amount_cents,
            allocated_cents=value, remaining_cents=task.amount_cents-value, status=derived_status(task),
            version=task.version, operation_at=task.operation_at.isoformat() if task.operation_at else None,
            offset_enabled=task.offset_enabled, settings_digest=task.source_snapshot['settings_digest'],
            candidates=payment_candidates(task.key) if derived_status(task) not in ('superseded','verified') else {'payments':[], 'requires_confirmation':False}))
    baselines = {} if state.get('baseline_reset') else state.get('baselines', {})
    missing = bool(batch and (batch.status != 'confirmed' or any(i.key not in baselines for i in items.values())))
    # A settled real ledger can establish a baseline on explicit refresh.
    required = missing and (batch.status != 'confirmed' or any(totals(i)[0] != totals(i)[1] for i in items.values() if i.key not in baselines))
    return dict(batch_id=batch.id if batch else None, batch_version=batch.version if batch else None,
        offset_enabled=enabled, settings_digest=setting_digest,
        queue_offset_enabled=state.get('offset_enabled'), settings_changed=bool(state and state.get('settings_digest') != setting_digest),
        baseline_required=bool(required), baseline_reason='请先核对实际流水并确认剩余义务基线' if required else '',
        current_task_key=state.get('current_task_key'), tasks=result,
        baseline_items=[dict(item_key=i.key, emp_no=i.emp_no_snapshot, name=i.name,
            due_cents=totals(i)[0], paid_cents=totals(i)[1], difference_cents=totals(i)[0]-totals(i)[1])
            for i in sorted(items.values(), key=lambda i:i.emp_no_snapshot) if i.key not in baselines])


def write_request(body, operator, action, task_key=None):
    key = required_text(body.get('request_key'), '请求标识', 100)
    if type(body.get('batch_id')) is not int:
        raise MealError('核算批次无效')
    batch = MealTicketBatch.query.filter_by(id=body['batch_id']).with_for_update().first()
    if not batch:
        raise MealError('核算批次不存在', 404)
    content = digest({'body':{k:v for k,v in body.items() if k != 'batch_id'},
                      'batch_key':batch.key, 'action':action, 'task_key':task_key, 'operator':operator})
    previous = (batch.followup_state or {}).get('requests', {}).get(key)
    if previous:
        if previous['digest'] != content:
            raise MealError('请求标识已用于不同内容', 409)
        result = deepcopy(previous['result'])
        result.pop('batch_key', None)
        result['batch_id'] = batch.id
        return batch, key, content, result
    batch_for_write(body['batch_id'], body.get('version'))
    if batch.status != 'confirmed':
        raise MealError('请先确认核算', 409)
    return batch, key, content, None


def save_result(batch, state, key, content):
    batch.followup_state = state
    db.session.flush()
    result = get_queue(batch)
    state = deepcopy(state)
    portable_result = {k:v for k,v in result.items() if k != 'batch_id'}
    portable_result['batch_key'] = batch.key
    state.setdefault('requests', {})[key] = {'digest':content, 'result':portable_result}
    batch.followup_state = state
    db.session.flush()
    return result


def cursor(state, batch):
    queue = get_queue(batch)
    available = [t['key'] for t in queue['tasks'] if t['status'] in ('pending', 'skipped')]
    if state.get('current_task_key') not in available:
        state['current_task_key'] = available[0] if available else None


def refresh_queue(body, operator):
    batch, key, content, previous = write_request(body, operator, 'refresh')
    if previous is not None:
        return previous
    enabled, setting_digest = settings()
    if body.get('settings_digest') != setting_digest:
        raise MealError('设置已变化，请刷新后操作', 409)
    state = deepcopy(batch.followup_state or {'baselines':{}, 'requests':{}, 'skip_sequence':0})
    if state.pop('baseline_reset', False):
        state['baselines'] = {}
    items = MealTicketItem.query.filter_by(batch_key=batch.key).all()
    confirmations = body.get('baselines', {})
    if not isinstance(confirmations, dict) or set(confirmations) - {i.key for i in items}:
        raise MealError('基线确认人员无效')
    for item in items:
        due, paid, adjustments, payments = totals(item)
        baseline = state['baselines'].get(item.key)
        if baseline is None:
            explicit = confirmations.get(item.key)
            if due != paid or explicit is not None:
                if explicit is None:
                    raise MealError('请先核对实际流水并确认剩余义务基线', 409)
                if not isinstance(explicit, dict):
                    raise MealError('基线确认内容必须是对象')
                reason = required_text(explicit.get('reason'), '基线确认说明')
                try:
                    project_pending_amounts(explicit.get('recharge_cents'), explicit.get('refund_cents'), enabled)
                except ValueError as exc:
                    raise MealError(str(exc))
                if explicit['recharge_cents'] - explicit['refund_cents'] != due-paid:
                    raise MealError('确认基线方向金额与实际净差额不符')
            else:
                reason = '已核实账目结清基线'
            baseline = dict(baseline_at=datetime.utcnow().isoformat(), due_cents=due, paid_cents=paid, payments={p.key:p.amount_cents for p in payments},
                adjustments={a.key:a.amount_cents for a in adjustments}, reason=reason, operator=operator,
                payment_date=max([p.payment_date.isoformat() for p in payments], default=batch.recharge_month+'-01'))
            baseline['initial'] = {'recharge': explicit['recharge_cents'], 'refund': explicit['refund_cents']} if explicit is not None else {'recharge':0, 'refund':0}
            state['baselines'][item.key] = baseline
        existing = Task.query.filter_by(item_key=item.key).all()
        frozen = [t for t in existing if t.status != 'superseded' and
                  (t.status not in ('pending', 'skipped') or allocated(t) or t.operation_at)]
        consumed = {k for t in frozen for k in t.source_snapshot.get('adjustments', {})}
        remaining = {a.key:a.amount_cents for a in adjustments if a.key not in baseline['adjustments'] and a.key not in consumed}
        # Unassociated funds since the baseline require reconciliation, never a
        # fresh queue guessing whether an external operation has already occurred.
        linked = {a.payment_key for a in Allocation.query.join(Task, Task.key == Allocation.task_key).filter(Task.item_key == item.key)}
        if any(p.key not in baseline['payments'] and p.key not in linked and p.kind != 'reversal' and effective_payment(p) for p in payments):
            raise MealError('存在未关联的实际流水，请先核对任务关联', 409)
        recharge = sum(v for v in remaining.values() if v > 0)
        refund = -sum(v for v in remaining.values() if v < 0)
        initial_remaining = dict(baseline['initial'])
        for task in frozen:
            for direction, amount in task.source_snapshot.get('initial', {}).items():
                initial_remaining[direction] -= amount
        recharge += initial_remaining['recharge']
        refund += initial_remaining['refund']
        projections = project_pending_amounts(recharge, refund, enabled)
        snapshots = {}
        for projection in projections:
            direction = projection['kind']
            snapshots[direction] = {**baseline,
                'adjustments':{k:v for k,v in remaining.items() if enabled or (v > 0) == (direction == 'recharge')},
                'settings_digest':setting_digest, 'request_digest':content,
                'initial':{k:v for k,v in initial_remaining.items() if enabled or k == direction},
                'source_digest':digest({a.key:a.amount_cents for a in adjustments})}
        pending = [t for t in existing if t not in frozen and t.status in ('pending','skipped')]
        same = len(pending) == len(projections) and all(any(t.kind == p['kind'] and t.amount_cents == p['amount_cents']
            and {k:v for k,v in t.source_snapshot.items() if k not in ('operations', 'source_digest', 'request_digest')} == {k:v for k,v in snapshots[p['kind']].items() if k not in ('source_digest', 'request_digest')}
            and t.offset_enabled == enabled for t in pending) for p in projections)
        if same:
            for task in pending:
                task.source_snapshot = {**task.source_snapshot, 'source_digest':snapshots[task.kind]['source_digest']}
        if not same:
            for task in pending:
                task.status = 'superseded'; task.version += 1
            for projection in projections:
                db.session.add(Task(month=batch.month, batch_key=batch.key, item_key=item.key,
                    **projection, source_snapshot=snapshots[projection['kind']], offset_enabled=enabled, operator=operator))
    state.update(offset_enabled=enabled, settings_digest=setting_digest)
    batch.followup_state = state
    batch.version += 1
    db.session.flush()
    cursor(state, batch)
    return save_result(batch, state, key, content)


def progress_task(task_key, body, operator):
    batch, key, content, previous = write_request(body, operator, 'progress', task_key)
    if previous is not None:
        return previous
    task = Task.query.filter_by(key=task_key, batch_key=batch.key).with_for_update().first()
    if not task:
        raise MealError('任务不存在', 404)
    if type(body.get('task_version')) is not int or body['task_version'] != task.version:
        raise MealError('任务已变化，请刷新后操作', 409)
    state = deepcopy(batch.followup_state)
    action, status = body.get('action'), derived_status(task)
    if status in ('pending','skipped') and not task.operation_at and task.source_snapshot['settings_digest'] != settings()[1]:
        raise MealError('设置已变化，请刷新操作清单', 409)
    if status in ('pending','skipped') and not task.operation_at:
        current_sources = {a.key:a.amount_cents for a in MealTicketAdjustment.query.filter_by(item_key=task.item_key)}
        if task.source_snapshot.get('source_digest') != digest(current_sources):
            raise MealError('补扣来源已变化，请刷新操作清单', 409)
    history = list(task.source_snapshot.get('operations', []))
    if action == 'skip' and status == 'pending':
        state['skip_sequence'] += 1
        task.skip_order = state['skip_sequence']; task.status = 'skipped'
    elif action == 'complete' and status in ('pending', 'skipped'):
        task.status = 'partial' if allocated(task) else 'awaiting'
        task.operation_at = datetime.utcnow()
    elif action == 'undo' and status == 'awaiting' and not Allocation.query.filter_by(task_key=task.key).first():
        task.status = 'pending'; task.operation_at = None
    elif action == 'retry' and status in ('awaiting','partial'):
        required_text(body.get('reason'), '确认尚未到账的重新办理原因')
        # Real funds may arrive before a separate completion declaration. This
        # explicit confirmation supplies the operation evidence required for retry.
        task.operation_at = task.operation_at or datetime.utcnow()
        task.status = 'pending'
        # Keep the original operation timestamp and snapshot: refresh must not
        # re-offset this explicitly reopened remaining obligation.
    elif action == 'select' and status in ('pending','skipped'):
        state['current_task_key'] = task.key
    else:
        raise MealError('任务状态不允许此操作', 409 if action in ('skip','complete','undo','retry','select') else 400)
    history.append(dict(action=action, request_digest=content, reason=body.get('reason'), operator=operator, at=datetime.utcnow().isoformat()))
    task.source_snapshot = {**task.source_snapshot, 'operations':history}
    task.operator = operator; task.version += 1; batch.version += 1
    if action != 'select': state['current_task_key'] = None
    db.session.flush()
    cursor(state, batch)
    return save_result(batch, state, key, content)


def refresh_allocations(task_key):
    task = Task.query.filter_by(key=task_key).first()
    if not task:
        raise MealError('任务不存在', 404)
    batch = MealTicketBatch.query.filter_by(key=task.batch_key).populate_existing().with_for_update().one()
    task = Task.query.filter_by(key=task_key).populate_existing().with_for_update().one()
    new_status = derived_status(task)
    if task.status != new_status:
        task.status = new_status; task.version += 1; batch.version += 1
    return task


def allocate_payment(task_key, payment_key, amount_cents, operator):
    if type(amount_cents) is not int or amount_cents <= 0:
        raise MealError('分配金额必须为正整数分')
    task = Task.query.filter_by(key=task_key).first()
    if not task:
        raise MealError('任务不存在', 404)
    # All queue/fund writes take the batch lock first, then payment/task locks.
    batch = MealTicketBatch.query.filter_by(key=task.batch_key).populate_existing().with_for_update().one()
    task = Task.query.filter_by(key=task_key).populate_existing().with_for_update().one()
    payment = MealTicketPayment.query.filter_by(key=payment_key).populate_existing().with_for_update().first()
    if not payment:
        raise MealError('实际流水不存在', 404)
    previous = Allocation.query.filter_by(task_key=task_key, payment_key=payment_key).first()
    if previous:
        if previous.amount_cents != amount_cents:
            raise MealError('该流水已按其他金额分配', 409)
        return previous
    snapshot = task.source_snapshot
    if (not after_remote_baseline(payment, task) or batch.status != 'confirmed' or task.status == 'superseded' or payment.item_key != task.item_key
            or payment.month != task.month or payment.kind != task.kind
            or (payment.amount_cents > 0) != (task.kind == 'recharge')
            or payment.key in snapshot['payments']
            or payment.created_at < datetime.fromisoformat(snapshot['baseline_at'])
            or payment.payment_date.isoformat() < snapshot.get('payment_date', batch.recharge_month+'-01')):
        raise MealError('流水人员、方向、月份或资金基线不匹配', 409)
    used = sum(a.amount_cents for a in Allocation.query.filter_by(payment_key=payment_key).all())
    if amount_cents > effective_payment(payment)-used or amount_cents > task.amount_cents-allocated(task):
        raise MealError('分配金额超过实际可用资金或任务剩余金额', 409)
    allocation = Allocation(month=task.month, task_key=task.key, payment_key=payment.key,
                            amount_cents=amount_cents, operator=operator)
    db.session.add(allocation)
    db.session.flush()
    task.status = 'verified' if allocated(task) == task.amount_cents else 'partial'
    task.version += 1; batch.version += 1
    state = deepcopy(batch.followup_state)
    cursor(state, batch)
    batch.followup_state = state
    return allocation


def payment_candidates(task_key):
    """Read-only candidates; ambiguity always requires explicit portable keys.

    Phase 5 can consume this result without guessing from equal amounts or dates.
    Even an unambiguous suggestion does not itself write an allocation.
    """
    task = Task.query.filter_by(key=task_key).first()
    if not task:
        raise MealError('任务不存在', 404)
    snapshot = task.source_snapshot
    candidates = []
    for payment in MealTicketPayment.query.filter_by(item_key=task.item_key, kind=task.kind, month=task.month):
        if (not after_remote_baseline(payment, task) or payment.key in snapshot['payments'] or payment.created_at < datetime.fromisoformat(snapshot['baseline_at'])
                or payment.payment_date.isoformat() < snapshot.get('payment_date', '0001-01-01')):
            continue
        used = sum(a.amount_cents for a in Allocation.query.filter_by(payment_key=payment.key))
        available = effective_payment(payment) - used
        if available > 0:
            candidates.append({'payment_key':payment.key, 'available_cents':available,
                'date':payment.payment_date.isoformat(), 'reference':payment.reference})
    peers = [t for t in Task.query.filter_by(item_key=task.item_key, kind=task.kind)
             if derived_status(t) not in ('superseded','verified')]
    sources = {a.key:a.amount_cents for a in MealTicketAdjustment.query.filter_by(item_key=task.item_key)}
    stale = not task.operation_at and task.status in ('pending','skipped') and (
        task.source_snapshot['settings_digest'] != settings()[1] or task.source_snapshot.get('source_digest') != digest(sources))
    return {'payments':candidates, 'requires_confirmation':bool(candidates) and (len(candidates) > 1 or len(peers) > 1
        or stale or any(p['available_cents'] > task.amount_cents - allocated(task) for p in candidates))}



def invalidate_for_draft(batch):
    """Retreat is safe only before any declared external operation or funds."""
    tasks = Task.query.filter_by(batch_key=batch.key).all()
    if any(t.operation_at or t.status in ('awaiting','partial','verified') for t in tasks):
        raise MealError('已有后续操作待核对，不能退回草稿，请先核对或撤销未实际操作的标记', 409)
    if batch.followup_state is not None:
        for task in tasks:
            if task.status in ('pending','skipped'):
                task.status = 'superseded'; task.version += 1
        batch.followup_state = {**deepcopy(batch.followup_state), 'baseline_reset':True, 'current_task_key':None}


def task_for_payment(batch, item, body, amount):
    task = Task.query.filter_by(key=body['task_key'], batch_key=batch.key).with_for_update().first()
    if not task:
        raise MealError('任务不存在', 404)
    if (type(body.get('task_version')) is not int or body['task_version'] != task.version
            or task.item_key != item.key or task.kind != body.get('kind')
            or derived_status(task) in ('superseded', 'verified')):
        raise MealError('任务人员、方向或版本不匹配，请刷新后操作', 409)
    if not task.operation_at and task.status in ('pending', 'skipped'):
        sources = {a.key:a.amount_cents for a in MealTicketAdjustment.query.filter_by(item_key=item.key)}
        if task.source_snapshot['settings_digest'] != settings()[1] or task.source_snapshot.get('source_digest') != digest(sources):
            raise MealError('设置或补扣来源已变化，请刷新操作清单', 409)
    if amount <= 0 or amount > task.amount_cents - allocated(task):
        raise MealError('实际金额必须大于零且不能超过任务剩余金额', 409)
    return task


def sync_batch_allocations(batch, operator, automatic=False):
    """Synchronize reversals and uniquely attributable funds in the caller transaction."""
    tasks = Task.query.filter_by(batch_key=batch.key).all()
    for task in tasks:
        if task.status != 'superseded':
            refresh_allocations(task.key)
    if automatic:
        # Compute every suggestion before assigning any funds; one assignment
        # must not turn an originally ambiguous sibling into a unique match.
        suggestions = [(task, payment_candidates(task.key)) for task in tasks
                       if derived_status(task) not in ('superseded', 'verified')]
        for task, candidates in suggestions:
            if not candidates['requires_confirmation'] and len(candidates['payments']) == 1:
                candidate = candidates['payments'][0]
                amount = min(candidate['available_cents'], task.amount_cents - allocated(task))
                allocate_payment(task.key, candidate['payment_key'], amount, operator)
    state = deepcopy(batch.followup_state)
    if state:
        cursor(state, batch)
        batch.followup_state = state


def link_payment(task_key, body, operator):
    batch, key, content, previous = write_request(body, operator, 'allocation', task_key)
    if previous is not None:
        return previous
    task = Task.query.filter_by(key=task_key, batch_key=batch.key).with_for_update().first()
    if not task:
        raise MealError('任务不存在', 404)
    if type(body.get('task_version')) is not int or body['task_version'] != task.version:
        raise MealError('任务已变化，请刷新后关联', 409)
    payment_key = required_text(body.get('payment_key'), '实际流水标识', 100)
    allocate_payment(task_key, payment_key, body.get('amount_cents'), operator)
    return save_result(batch, deepcopy(batch.followup_state), key, content)


def after_remote_baseline(payment, task):
    snapshot = task.source_snapshot
    if not payment.request_key.startswith('card-meal:'):
        return True
    # Reconciliation has always stored the precise source timestamp in reference.
    # Card database timestamps are China local time; task baseline_at is UTC naive.
    from datetime import timezone
    from zoneinfo import ZoneInfo
    try:
        occurred = datetime.fromisoformat(payment.reference.rsplit(' · ', 1)[-1])
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        baseline = max(datetime.fromisoformat(snapshot['baseline_at']), task.created_at).replace(tzinfo=timezone.utc)
        return occurred >= baseline
    except (ValueError, TypeError):
        return False

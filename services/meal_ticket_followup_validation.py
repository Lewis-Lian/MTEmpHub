"""Validate the chosen portable final state before any restore writes."""
from datetime import date, datetime


def validate_followup_records(records):
    errors = []
    def fail(key, message, required=()):
        errors.append(('meal_followup_invalid', key, message, list(required)))
    tasks = records.get('meal_followup_tasks', {})
    payments = records.get('meal_payments', {})
    items = records.get('meal_items', {})
    batches = records.get('meal_batches', {})
    allocations = records.get('meal_followup_allocations', {})
    reversed_keys = {v['reversal_of'] for _, v in payments.values() if v.get('reversal_of')}
    task_used, payment_used, pairs, consumed_sources = {}, {}, {}, {}
    def validate_sources(key, snapshot, item_key):
        for field, parent in (('payments', payments), ('adjustments', records.get('meal_adjustments', {}))):
            values = snapshot.get(field)
            if not isinstance(values, dict):
                fail(key, '后续任务来源映射无效'); continue
            for identifier, amount in values.items():
                source = parent.get(identifier)
                if not source or type(amount) is not int or source[1]['item_key'] != item_key or source[1]['amount_cents'] != amount:
                    fail(key, '后续任务来源缺失或与人员及金额不一致', [source[0]] if source else [field + '/' + identifier])
    for key, value in tasks.values():
        snapshot = value['source_snapshot']
        item = items.get(value['item_key'])
        batch = batches.get(value['batch_key'])
        if (value['kind'] not in ('recharge','refund') or value['amount_cents'] <= 0
                or value['status'] not in ('pending','skipped','awaiting','partial','verified','superseded')
                or value['version'] < 1 or value['skip_order'] < 0
                or not isinstance(snapshot, dict) or not isinstance(snapshot.get('payments'), dict)
                or not isinstance(snapshot.get('adjustments'), dict) or not isinstance(snapshot.get('settings_digest'), str)):
            fail(key, '后续任务金额、状态或来源快照无效')
            continue
        validate_sources(key, snapshot, value['item_key'])
        initial = snapshot.get('initial', {})
        if (not isinstance(initial, dict) or set(initial) - {'recharge','refund'}
                or any(type(v) is not int or v < 0 for v in initial.values())
                or any(type(v) is not int for v in snapshot['adjustments'].values())):
            fail(key, '后续任务方向来源金额无效'); continue
        recharge = initial.get('recharge', 0) + sum(v for v in snapshot['adjustments'].values() if v > 0)
        refund = initial.get('refund', 0) - sum(v for v in snapshot['adjustments'].values() if v < 0)
        expected = abs(recharge-refund) if value['offset_enabled'] else (recharge if value['kind']=='recharge' else refund)
        if (expected != value['amount_cents'] or (value['offset_enabled'] and
                (recharge > refund) != (value['kind'] == 'recharge'))):
            fail(key, '后续任务金额与未消费来源义务不一致')
        if value['status'] != 'superseded':
            for identifier in snapshot['adjustments']:
                if identifier in consumed_sources:
                    fail(key, '同一补扣来源不能被多个有效任务重复消费', [consumed_sources[identifier]])
                consumed_sources[identifier] = key
        try:
            if datetime.fromisoformat(snapshot['baseline_at']).tzinfo is not None:
                raise ValueError('基线必须为 UTC naive 时间')
            if 'payment_date' in snapshot:
                date.fromisoformat(snapshot['payment_date'])
        except (ValueError, TypeError, KeyError):
            fail(key, '后续任务资金基线时间无效')
        if not item or not batch or item[1]['batch_key'] != value['batch_key'] or (batch[1]['status'] != 'confirmed' and value['status'] != 'superseded'):
            fail(key, '后续任务必须关联同一已确认批次的人员明细')
        if batch:
            state = batch[1].get('followup_state')
            if (not isinstance(state, dict) or not isinstance(state.get('baselines'), dict)
                    or value['item_key'] not in state['baselines']):
                fail(key, '后续任务缺少持久化清单资金基线', [batch[0]])
    for key, value in allocations.values():
        task = tasks.get(value['task_key'])
        payment = payments.get(value['payment_key'])
        if not task or not payment:
            fail(key, '任务资金分配缺少父任务或实际流水')
            continue
        t, p = task[1], payment[1]
        if not isinstance(t['source_snapshot'], dict) or not isinstance(t['source_snapshot'].get('payments'), dict):
            fail(key, '任务分配来源快照无效'); continue
        pair = (t['key'], p['key'])
        if pair in pairs:
            fail(key, '同任务同流水不能重复分配', [pairs[pair]])
        pairs[pair] = key
        if (value['amount_cents'] <= 0 or p['item_key'] != t['item_key'] or p['kind'] != t['kind']
                or (p['amount_cents'] > 0) != (t['kind'] == 'recharge')
                or p['month'] != t['month'] or value['month'] != t['month']
                or p['key'] in t['source_snapshot'].get('payments', {})):
            fail(key, '任务分配人员、方向、月份、基线或金额不符', [task[0],payment[0]])
        try:
            if (datetime.fromisoformat(p['created_at']) < datetime.fromisoformat(t['source_snapshot']['baseline_at'])
                    or p['payment_date'] < t['source_snapshot'].get('payment_date', '0001-01-01')):
                fail(key, '历史基线以前的流水不能核销新任务')
        except (ValueError, KeyError, TypeError):
            fail(key, '任务分配基线无效')
        # Keep reversed allocations as historical relationships, but they no
        # longer contribute to a task's matched balance.
        if p['key'] not in reversed_keys:
            task_used[t['key']] = task_used.get(t['key'], 0) + value['amount_cents']
        payment_used[p['key']] = payment_used.get(p['key'], 0) + value['amount_cents']
    for identifier, used in payment_used.items():
        key, value = payments[identifier]
        if used > abs(value['amount_cents']):
            fail(key, '任务分配总额超过实际流水金额')
    for identifier, (key, value) in tasks.items():
        used = task_used.get(identifier, 0)
        if value['status'] in ('pending','skipped') and (used or value.get('operation_at')):
            history = value['source_snapshot'].get('operations', []) if isinstance(value['source_snapshot'], dict) else []
            actions = [entry.get('action') for entry in history if isinstance(entry, dict)
                       and entry.get('action') in ('complete','undo','retry')] if isinstance(history, list) else []
            if used >= value['amount_cents'] or not value.get('operation_at') or not actions or actions[-1] != 'retry':
                fail(key, '已有操作或实际到账的任务必须经明确确认重新办理，不能直接恢复为待操作')
        if (used > value['amount_cents'] or (value['status'] == 'verified' and used != value['amount_cents'])
                or (value['status'] == 'partial' and not 0 < used < value['amount_cents'])
                or (value['status'] in ('awaiting','superseded') and used)):
            fail(key, '任务状态与有效资金分配不一致')
    for key, batch in batches.values():
        state = batch.get('followup_state')
        if state is None:
            continue
        if (not isinstance(state, dict) or not isinstance(state.get('requests'), dict)
                or type(state.get('skip_sequence')) is not int or state['skip_sequence'] < 0
                or ('baseline_reset' in state and type(state['baseline_reset']) is not bool)):
            fail(key, '后续清单导航与基线状态无效'); continue
        baselines = state.get('baselines', {})
        if not isinstance(baselines, dict):
            fail(key, '后续清单资金基线无效'); continue
        for item_key, snapshot in baselines.items():
            if item_key not in items or items[item_key][1]['batch_key'] != batch['key'] or not isinstance(snapshot, dict):
                fail(key, '后续清单资金基线人员明细无效'); continue
            validate_sources(key, snapshot, item_key)
            initial = snapshot.get('initial')
            if (not isinstance(initial, dict) or set(initial) != {'recharge','refund'}
                    or any(type(v) is not int or v < 0 for v in initial.values())):
                fail(key, '后续清单剩余方向基线无效')
            try:
                if datetime.fromisoformat(snapshot['baseline_at']).tzinfo is not None:
                    raise ValueError('基线必须为 UTC naive 时间')
                if 'payment_date' in snapshot:
                    date.fromisoformat(snapshot['payment_date'])
            except (ValueError, TypeError, KeyError):
                fail(key, '后续清单资金基线时间无效')
        for request in state['requests'].values():
            if (not isinstance(request, dict) or not isinstance(request.get('digest'), str)
                    or not isinstance(request.get('result'), dict) or request['result'].get('batch_key') != batch['key']
                    or 'batch_id' in request['result']):
                fail(key, '后续清单请求记录必须使用可移植批次编号')
        current = state.get('current_task_key')
        if current is not None and not isinstance(current, str):
            fail(key, '当前任务定位必须为业务编号'); continue
        if current and (current not in tasks or tasks[current][1]['batch_key'] != batch['key']):
            fail(key, '当前后续任务定位缺少本批次父任务')
    return errors

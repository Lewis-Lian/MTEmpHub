import { useEffect, useRef, useState } from 'react';
import { applyReferenceOperation, fetchReferenceDetail, listReferenceMonths, previewReferenceOperation,
  type ReferenceDetail, type ReferenceKind, type ReferenceMonth, type ReferenceOperation,
  type ReferencePreview, type ReferenceSnapshot } from '../../api/monthlyReferences';
import { clearQueryBootstrapCache } from '../../api/query';
import { useNotification } from '../../components/feedback/Notification';
import QueryTable from '../../components/query/QueryTable';
import { displayBackupValue, fieldLabel } from '../../components/admin/backupLabels';
import './monthly-references.css';

const KIND_LABELS: Record<ReferenceKind, string> = {employee: '员工', department: '部门', shift: '班次'};
const MAIN_PREVIEW_FIELDS = new Set(['emp_no', 'name', 'dept_no', 'dept_name', 'parent_no', 'default_shift_no', 'shift_no', 'shift_name', 'time_slots', 'is_cross_day']);
function label(field: string) {
  const names: Record<string, string> = {default_shift_no: '默认班次编号',
    employee_attendance_source: '员工打卡数据来源（整月）', manager_attendance_source: '管理人员打卡数据来源（整月）'};
  return names[field] ?? fieldLabel({name: field});
}
function displayValue(value: unknown, field = '') {
  if (field === 'time_slots' && value != null) {
    const periods = readSlots(value);
    return periods ? periods.map(([start, end]) => `${start || '未填写'}—${end || '未填写'}`).join('；') || '未设置时段' : '原有时段格式需核对';
  }
  if (field.endsWith('_stats_attendance_source')) {
    return ({employee: '员工考勤', manager: '管理人员考勤', auto_fallback: '自动回退'} as Record<string, string>)[String(value)] ?? displayBackupValue(value, field);
  }
  return displayBackupValue(value, field);
}
function message(error: unknown) { return error instanceof Error ? error.message : '快照操作失败'; }

export default function MonthlyReferencesPage() {
  const notification = useNotification();
  const [months, setMonths] = useState<ReferenceMonth[]>([]);
  const [month, setMonth] = useState('');
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<ReferenceKind>('employee');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<ReferenceSnapshot | null>(null);
  const [comparison, setComparison] = useState<{preview: ReferencePreview; operation: ReferenceOperation} | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const revision = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);

  const activeDialog = comparison ? 'confirm' : selected ? 'view' : '';
  useEffect(() => {
    if (!activeDialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = activeDialog === 'confirm' ? 'input[type=checkbox]' : 'button';
    dialogRef.current?.querySelector<HTMLElement>(target)?.focus();
    return () => {previous?.focus();};
  }, [activeDialog]);

  useEffect(() => {
    let active = true;
    listReferenceMonths().then(result => {
      if (active) {setMonths(result.months); setMonth(result.months[0]?.month ?? '');}
    }).catch(caught => {if (active) setError(message(caught));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, []);

  useEffect(() => {
    if (!month) return;
    const version = ++revision.current;
    setLoading(true); setDetail(null); setSelected(null); setComparison(null); setError('');

    fetchReferenceDetail(month, false).then(result => {
      if (version === revision.current) setDetail(result);
    }).catch(caught => {if (version === revision.current) setError(message(caught));})
      .finally(() => {if (version === revision.current) setLoading(false);});
    return () => {revision.current++;};
  }, [month]);

  async function reload() {
    setBusy(true); setError(''); setComparison(null);
    const version = ++revision.current;
    try {
      const [list, next] = await Promise.all([listReferenceMonths(), fetchReferenceDetail(month, false)]);
      if (version === revision.current) {
        setMonths(list.months); setDetail(next); setSelected(null);
      }
    } catch (caught) {if (version === revision.current) {setError(message(caught)); setDetail(null);}}
    finally {if (version === revision.current) setBusy(false);}
  }

  async function compare(operation: ReferenceOperation) {
    if (!detail || detail.is_locked || busy) return;
    setBusy(true); setError(''); setAcknowledged(false);
    try {setComparison({preview: await previewReferenceOperation(month, operation), operation});}
    catch (caught) {setError(message(caught)); setComparison(null);}
    finally {setBusy(false);}
  }

  async function apply() {
    if (!comparison || !acknowledged || busy) return;
    setBusy(true); setError('');
    try {
      const result = await applyReferenceOperation(month, comparison.operation, comparison.preview.fingerprint);
      clearQueryBootstrapCache(); setComparison(null); setSelected(null);
      notification.success(`${result.month} 快照操作完成，变更 ${result.changed_count} 条`);
      // A successful write is final even if the following read fails.
      setDetail(null);
      const [list, next] = await Promise.all([listReferenceMonths(), fetchReferenceDetail(month, false)]);
      setMonths(list.months); setDetail(next);
    } catch (caught) {setError(message(caught)); setComparison(null);}
    finally {setBusy(false);}
  }

  function chooseSnapshot(row: ReferenceSnapshot) {
    setSelected(row); setComparison(null); setError('');
  }

  const disabled = busy || loading || !!comparison;
  const writeDisabled = disabled || !detail || detail.is_locked;
  const records = detail?.snapshots.filter(row => (!kind || row.kind === kind)
    && (!keyword || `${row.business_key} ${row.payload.name ?? row.payload.dept_name ?? row.payload.shift_name ?? ''}`.includes(keyword))) ?? [];
  const navigationDisabled = disabled || !!selected;
  const savedCount = detail?.snapshots.length ?? 0;
  const missingCount = detail?.missing.length ?? 0;
  const captureLabel = !savedCount ? '生成本月快照' : missingCount ? '补齐缺失资料' : '资料已完整';
  const statusText = !savedCount ? '尚未保存本月资料' : missingCount ? `还缺 ${missingCount} 条资料` : '本月资料已保存';
  function relatedName(type: ReferenceKind, key: unknown) {
    if (!key) return '—';
    const row = detail?.snapshots.find(item => item.kind === type && item.business_key === key);
    return String(row?.payload.dept_name ?? row?.payload.shift_name ?? `${key}（待补齐）`);
  }
  const rebuilding = comparison?.operation.action === 'rebuild';
  const confirmTitle = rebuilding ? '确认重建本月快照' : '确认保存本月资料';
  function closeDialog() {if (comparison) setComparison(null); else setSelected(null);}

  return <main className="snapshot-page" aria-label="月度快照管理">
    <div aria-hidden={!!activeDialog}>
      <header className="snapshot-header"><div><span className="snapshot-eyebrow">每个月的资料，单独留存</span><h2>快照管理</h2>
        <p>保存本月的员工、部门和班次资料，之后修改人员信息，旧月份仍使用当月保存的资料。</p></div>
        <button className="snapshot-button" disabled={busy || loading || !month || !!activeDialog} onClick={() => void reload()}>刷新资料</button></header>
      {error && !activeDialog && <p className="snapshot-error" role="alert">{error}</p>}
      <section className="snapshot-month-bar" aria-label="选择月份">
        <label>账套月份<select value={month} disabled={navigationDisabled || !months.length} onChange={event => {
          setMonth(event.target.value); setKind('employee'); setKeyword('');
        }}>{!months.length && <option value="">暂无月份</option>}{months.map(row => <option key={row.month} value={row.month}>{row.month} · {row.name || '月度账套'}{row.is_locked ? '（已锁定）' : ''}</option>)}</select></label>
        <span>先选月份，再查看或保存这个月的资料</span>
      </section>
      {loading && <p className="snapshot-loading" role="status">正在读取这个月的资料…</p>}
      {!loading && !month && !error && <section className="snapshot-card snapshot-empty"><h3>还没有可管理的月份</h3><p>先在账套中心创建一个月份，再来保存资料。</p><a href="/admin/dashboard">前往账套中心</a></section>}
      {detail && <>
        <section className={`snapshot-overview ${!missingCount && savedCount ? 'is-complete' : ''}`}>
          <div className="snapshot-overview-icon" aria-hidden="true">{!missingCount && savedCount ? '✓' : '+'}</div>
          <div className="snapshot-overview-copy"><div className="snapshot-status-line"><h3>{statusText}</h3>{detail.is_locked && <span className="snapshot-badge">月份已锁定</span>}</div>
            <p>{!savedCount ? '还没有保存员工、部门和班次资料，先生成一份本月快照。' : missingCount ? '部分资料尚未保存，补齐后可以一起用于本月查询和备份。' : '已保存当月资料，可查看姓名、部门和班次。'}</p>
            <div className="snapshot-counts"><span>已保存 <strong>{savedCount}</strong> 条</span><span>待补齐 <strong>{missingCount}</strong> 条</span></div>
          </div>
          <div className="snapshot-overview-action"><button className="snapshot-button snapshot-primary" disabled={writeDisabled || !missingCount || !!selected}
            onClick={() => void compare({action: 'capture'})}>{captureLabel}</button>
            {!!savedCount && <button className="snapshot-button" disabled={writeDisabled || !!selected} onClick={() => void compare({action: 'rebuild'})}>重建本月快照</button>}<small>{detail.is_locked ? '先在账套中心解锁，才能保存' : !missingCount ? '已保存，无需重复生成' : '先查看将保存的资料，再确认'}</small></div>
        </section>
        <p className="snapshot-hint">补齐使用的是现在的资料，已保存的记录会保留。处理旧月份时，请对照当时的报表核对。</p>
        <section className="snapshot-card snapshot-workspace">
            <div className="snapshot-table-tools"><div className="snapshot-type-buttons" role="group" aria-label="资料类型">{Object.entries(KIND_LABELS).map(([key, title]) => <button key={key}
              className={kind === key ? 'is-active' : ''} aria-label={title} aria-pressed={kind === key} disabled={navigationDisabled} onClick={() => setKind(key as ReferenceKind)}>{title}<span>{detail.snapshots.filter(row => row.kind === key).length}</span></button>)}</div>
              <div className="snapshot-filters"><label>搜索资料<input placeholder="输入编号或姓名" value={keyword} disabled={navigationDisabled} onChange={event => setKeyword(event.target.value)} /></label></div>
            </div>
            <QueryTable headers={kind === 'employee' ? ['工号', '姓名', '部门', '班次', '操作'] : ['编号', '名称', kind === 'department' ? '上级部门' : '时段', '操作']}
              rows={records.map(row => [row.business_key, String(row.payload.name ?? row.payload.dept_name ?? row.payload.shift_name ?? ''),
                ...(kind === 'employee' ? [relatedName('department', row.payload.dept_no), relatedName('shift', row.payload.default_shift_no)]
                  : [kind === 'department' ? relatedName('department', row.payload.parent_no) : displayValue(row.payload.time_slots, 'time_slots')]),
                <button className="snapshot-row-button" disabled={navigationDisabled} aria-label={`查看资料 ${row.business_key}`} onClick={() => chooseSnapshot(row)}>查看资料</button>])}
              emptyText={!savedCount ? '本月还没有保存资料，点击上方“生成本月快照”开始。' : '没有找到符合条件的资料。'} paginationKey={`${month}-${kind}-${keyword}`} />
        </section>
      </>}
    </div>
    {activeDialog && <div className="snapshot-backdrop"><section ref={dialogRef} className={`snapshot-dialog ${comparison ? 'snapshot-confirm-dialog' : 'snapshot-edit-dialog'}`} role="dialog" aria-modal="true"
      aria-label={comparison ? confirmTitle : '查看资料'}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) {event.preventDefault(); closeDialog();}
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled),summary'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!controls.length) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      }}>
      {comparison ? <>
        <div className="snapshot-dialog-head"><div><span className="snapshot-eyebrow">最后一步 · 核对后保存</span><h3>{confirmTitle}</h3></div>
          <button className="snapshot-icon-button" aria-label="关闭确认窗口" disabled={busy} onClick={closeDialog}>×</button></div>
        <div className="snapshot-dialog-body"><div className="snapshot-confirm-summary"><span>保存到 <strong>{comparison.preview.month}</strong></span><span>共 <strong>{comparison.preview.changes.length}</strong> 条资料</span></div>
          <p>{rebuilding ? '将用当前员工、部门和班次资料替换本月旧快照，旧快照不再保留。本月考勤、刷卡和菜票业务记录仍保留，请核对后确认。' : '以下资料将保存到所选月份。已有记录会保留，请检查名称、部门和班次是否正确。'}</p>

          <div className="snapshot-preview-list">{comparison.preview.changes.map(change => {
            const record = change.after ?? change.before!;
            if (!change.after) return <article key={`${change.kind}-${change.business_key}`}><h4>删除旧快照 · {String(record.payload.name ?? record.payload.dept_name ?? record.payload.shift_name ?? change.business_key)}<small>{KIND_LABELS[change.kind]} · {change.business_key}</small></h4></article>;
            const fields = Object.entries(record.payload).filter(([key, item]) => !change.before || JSON.stringify(item) !== JSON.stringify(change.before.payload[key]));
            const main = fields.filter(([key]) => change.before || MAIN_PREVIEW_FIELDS.has(key));
            const extra = change.before ? [] : fields.filter(([key]) => !MAIN_PREVIEW_FIELDS.has(key));
            const renderFields = (items: Array<[string, unknown]>) => <dl>{items.map(([key, item]) => <div key={key}><dt>{label(key)}</dt><dd>{change.before && <span className="snapshot-before">{displayValue(change.before.payload[key], key)} → </span>}{displayValue(item, key)}</dd></div>)}</dl>;
            return <article key={`${change.kind}-${change.business_key}`}><h4>{String(change.after.payload.name ?? change.after.payload.dept_name ?? change.after.payload.shift_name ?? change.business_key)}<small>{KIND_LABELS[change.kind]} · {change.business_key}</small></h4>
              {renderFields(main)}{!!extra.length && <details className="snapshot-archive-details"><summary>查看其他保存信息</summary>{renderFields(extra)}</details>}
            </article>;
          })}</div>
          {!comparison.preview.changes.length && <p>没有需要保存的变更。</p>}
          <label className="snapshot-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />我已核对以上变更</label>
        </div>
        <div className="snapshot-dialog-footer"><button className="snapshot-button" disabled={busy} onClick={closeDialog}>返回检查</button>
          <button className="snapshot-button snapshot-primary" disabled={busy || !acknowledged || !comparison.preview.changes.length} onClick={() => void apply()}>{rebuilding ? '确认重建' : '确认保存'}</button></div>
      </> : selected && detail && <>
        <div className="snapshot-dialog-head"><div><span className="snapshot-eyebrow">{month} · {KIND_LABELS[selected.kind]}资料</span><h3>{String(selected.payload.name ?? selected.payload.dept_name ?? selected.payload.shift_name ?? selected.business_key)}<small>{selected.business_key}</small></h3></div>
          <button className="snapshot-icon-button" aria-label="关闭资料窗口" disabled={busy} onClick={closeDialog}>×</button></div>
        <div className="snapshot-dialog-body">{error && <p className="snapshot-error" role="alert">{error}</p>}
          <QueryTable headers={['资料', '当月保存的内容']} rows={Object.entries(selected.payload).filter(([key]) => MAIN_PREVIEW_FIELDS.has(key)).map(([key, item]) => [label(key), displayValue(item, key)])}
            paginationKey={`${month}-${selected.kind}-${selected.business_key}`} />
          <details className="snapshot-archive-details"><summary>查看其他保存信息</summary>
            <QueryTable headers={['资料', '当月保存的内容']} rows={Object.entries(selected.payload).filter(([key]) => !MAIN_PREVIEW_FIELDS.has(key)).map(([key, item]) => [label(key), displayValue(item, key)])}
              paginationKey={`${month}-${selected.kind}-${selected.business_key}-extra`} />
          </details>
        </div>
        <div className="snapshot-dialog-footer"><button className="snapshot-button" disabled={busy} onClick={closeDialog}>关闭</button></div>
      </>}
    </section></div>}
  </main>;
}

function readSlots(value: unknown): string[][] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const result: string[][] = [];
  for (const slot of value) {
    const pair = Array.isArray(slot) && slot.length === 2 ? slot
      : slot && typeof slot === 'object' && !Array.isArray(slot) ? [slot.start ?? slot.start_time, slot.end ?? slot.end_time] : null;
    if (!pair) return null;
    const normalized: string[] = [];
    for (const time of pair) {
      if (typeof time !== 'string' || (time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time.trim()))) return null;
      normalized.push(time ? time.trim().padStart(5, '0') : '');
    }
    result.push(normalized);
  }
  return result;
}

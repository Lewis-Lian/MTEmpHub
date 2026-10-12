import { useEffect, useRef, useState } from 'react';
import { applyReferenceOperation, fetchReferenceDetail, listReferenceMonths, previewReferenceOperation,
  type ReferenceDetail, type ReferenceKind, type ReferenceMonth, type ReferenceOperation,
  type ReferencePreview, type ReferenceSnapshot } from '../../api/monthlyReferences';
import { clearQueryBootstrapCache } from '../../api/query';
import { useNotification } from '../../components/feedback/Notification';
import QueryTable from '../../components/query/QueryTable';
import { displayBackupValue, fieldLabel, QUALITY_LABELS, snapshotSource } from '../../components/admin/backupLabels';
import './monthly-references.css';

const KIND_LABELS: Record<ReferenceKind, string> = {employee: '员工', department: '部门', shift: '班次'};
const CATEGORY_LABELS: Record<string, string> = {attendance: '考勤数据', meal_tickets: '菜票核算'};
const BOOLEAN_FIELDS = new Set(['is_active', 'is_manager', 'meal_ticket_as_manager', 'is_nursing', 'include_in_manager_stats', 'is_locked', 'is_cross_day']);
const ENUMS: Record<string, Array<[string, string]>> = {
  employee_stats_attendance_source: [['employee', '员工考勤'], ['manager', '管理人员考勤'], ['auto_fallback', '自动回退']],
  manager_stats_attendance_source: [['employee', '员工考勤'], ['manager', '管理人员考勤'], ['auto_fallback', '自动回退']],
};
const SOURCE_LABELS: Record<string, string> = {daily_records: '日报记录', monthly_reports: '月报记录', meal_ticket_items: '菜票明细', account_set_imports: '归档文件'};
function label(field: string) {
  const names: Record<string, string> = {default_shift_no: '默认班次编号',
    employee_attendance_source: '员工打卡数据来源（整月）', manager_attendance_source: '管理人员打卡数据来源（整月）'};
  return names[field] ?? fieldLabel({name: field});
}
function displayValue(value: unknown, field = '') {
  const enums = ENUMS[field] ?? (field.endsWith('_attendance_source') ? [['local', '本地导入'], ['dingtalk', '钉钉'], ['card_db', '刷卡数据库']] : []);
  return enums.find(([key]) => key === value)?.[1] ?? displayBackupValue(value, field);
}
function editText(value: unknown) { return value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value); }
function evidenceKey(key: string, field: string) { return JSON.stringify([key, field]); }
function message(error: unknown) { return error instanceof Error ? error.message : '快照操作失败'; }

export default function MonthlyReferencesPage() {
  const notification = useNotification();
  const [months, setMonths] = useState<ReferenceMonth[]>([]);
  const [month, setMonth] = useState('');
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspectArchives, setInspectArchives] = useState(false);
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');
  const [quality, setQuality] = useState('');
  const [selected, setSelected] = useState<ReferenceSnapshot | null>(null);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [evidenceChoices, setEvidenceChoices] = useState<Record<string, number>>({});
  const [comparison, setComparison] = useState<{preview: ReferencePreview; operation: ReferenceOperation} | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const revision = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!comparison) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {previous?.focus();};
  }, [comparison]);

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
    setCategories([]); setEvidenceChoices({});
    fetchReferenceDetail(month, inspectArchives).then(result => {
      if (version === revision.current) setDetail(result);
    }).catch(caught => {if (version === revision.current) setError(message(caught));})
      .finally(() => {if (version === revision.current) setLoading(false);});
    return () => {revision.current++;};
  }, [month, inspectArchives]);

  async function reload() {
    setBusy(true); setError(''); setComparison(null);
    const version = ++revision.current;
    try {
      const [list, next] = await Promise.all([listReferenceMonths(), fetchReferenceDetail(month, inspectArchives)]);
      if (version === revision.current) {
        setMonths(list.months); setDetail(next); setSelected(null); setEvidenceChoices({});
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
      clearQueryBootstrapCache(); setComparison(null); setSelected(null); setEvidenceChoices({});
      notification.success(`${result.month} 快照操作完成，变更 ${result.changed_count} 条`);
      // A successful write is final even if the following read fails.
      setDetail(null);
      const [list, next] = await Promise.all([listReferenceMonths(), fetchReferenceDetail(month, inspectArchives)]);
      setMonths(list.months); setDetail(next);
    } catch (caught) {setError(message(caught)); setComparison(null);}
    finally {setBusy(false);}
  }

  function chooseSnapshot(row: ReferenceSnapshot) {
    setSelected(row);
    const first = detail?.editable_fields[row.kind][0] ?? '';
    setField(first); setValue(editText(row.payload[first])); setComparison(null);
  }
  function correct() {
    if (!selected) return;
    try {
      const parsed = BOOLEAN_FIELDS.has(field) ? value === 'true' : field === 'time_slots' ? JSON.parse(value)
        : value === '' && ['resigned_at', 'card_no', 'dingtalk_user_id', 'dept_no', 'default_shift_no', 'parent_no'].includes(field) ? null : value;
      void compare({action: 'correct', kind: selected.kind, business_key: selected.business_key, changes: {[field]: parsed}, categories});
    } catch {setError('班次时段格式无效，请填写开始、结束时间组成的时段数组');}
  }

  const disabled = busy || loading || !!comparison;
  const writeDisabled = disabled || !detail || detail.is_locked;
  const records = detail?.snapshots.filter(row => (!kind || row.kind === kind) && (!quality || row.quality === quality)
    && (!keyword || `${row.business_key} ${row.payload.name ?? row.payload.dept_name ?? row.payload.shift_name ?? ''}`.includes(keyword))) ?? [];
  const decisions = (detail?.evidence ?? []).flatMap(row => {
    const index = evidenceChoices[evidenceKey(row.business_key, row.field)];
    return index === undefined ? [] : [{business_key: row.business_key, field: row.field, value: row.candidates[index].value}];
  });
  const current = selected && detail?.current.find(row => row.kind === selected.kind && row.business_key === selected.business_key);

  return <main className="snapshot-page" aria-label="月度快照管理">
    <header className="snapshot-header"><div><h2>快照管理</h2><p>核对历史资料、补齐缺失快照，并按月修正员工、部门及班次信息。</p></div>
      <button disabled={busy || loading || !month || !!comparison} onClick={() => void reload()}>刷新资料</button></header>
    {error && <p className="snapshot-error" role="alert">{error}</p>}
    {loading && <p role="status">正在读取月度快照…</p>}
    <div className="snapshot-layout">
      <aside className="snapshot-card snapshot-months" aria-label="月份列表"><h3>业务月份</h3>
        {!loading && !months.length && <p>暂无可管理的业务月份。</p>}
        {months.map(row => <button key={row.month} className={month === row.month ? 'is-selected' : ''} aria-pressed={month === row.month}
          disabled={busy || !!comparison} onClick={() => {setMonth(row.month); setInspectArchives(false);}}>
          <strong>{row.month} {row.is_locked && '已锁定'}</strong><span>{row.name}</span>
          <span>快照 {row.snapshot_count} · 缺失 {row.missing_count}</span>
          <small>基线 {row.quality_counts.baseline ?? 0} · 部分 {row.quality_counts.partial ?? 0} · 可证 {row.quality_counts.verified ?? 0}</small>
        </button>)}
      </aside>
      <div className="snapshot-content">{detail && <>
        <section className="snapshot-card"><div className="snapshot-section-head"><div><h3>{month} 月度资料</h3>
          <p>已有 {detail.snapshots.length} 条快照，缺失 {detail.missing.length} 条。</p></div>
          <button className="snapshot-primary" disabled={writeDisabled || !detail.missing.length} onClick={() => void compare({action: 'capture'})}>预览补齐缺失快照</button></div>
          <p className="snapshot-note">补齐以当前资料建立“旧数据基线”，只新增缺失记录，保留已有快照。基线能固定资料，但不能证明当月真实状态；请结合历史报表核对。</p>
          {detail.is_locked && <p className="snapshot-note">该月份已锁定，可查看资料；补齐或修正前请先在账套中心解锁。</p>}
          <div className="snapshot-toolbar"><label>资料类型<select value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="">全部类型</option>{Object.entries(KIND_LABELS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <label>资料质量<select value={quality} disabled={disabled} onChange={event => setQuality(event.target.value)}><option value="">全部质量</option>{Object.entries(QUALITY_LABELS).filter(([key]) => key !== 'missing').map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <label>编号或名称<input value={keyword} disabled={disabled} onChange={event => setKeyword(event.target.value)} /></label></div>
          <QueryTable headers={['类型', '编号', '名称', '资料质量', '操作']} rows={records.map(row => [KIND_LABELS[row.kind], row.business_key,
            String(row.payload.name ?? row.payload.dept_name ?? row.payload.shift_name ?? ''), QUALITY_LABELS[row.quality] ?? row.quality,
            <button disabled={disabled} aria-label={`查看快照 ${row.business_key}`} onClick={() => chooseSnapshot(row)}>查看 / 修正</button>])} emptyText="该月暂无符合条件的快照" paginationKey={`${month}-${kind}-${quality}-${keyword}`} />
        </section>

        <section className="snapshot-card"><h3>受影响业务</h3><p>修正或采用证据时，请明确勾选允许受影响的业务。服务端会检查是否漏选。</p>
          <fieldset className="snapshot-categories" disabled={writeDisabled}><legend>允许影响的业务类别</legend>{Object.entries(CATEGORY_LABELS).map(([key, title]) => <label key={key}>
            <input type="checkbox" checked={categories.includes(key)} onChange={event => {setCategories(event.target.checked ? [...categories, key] : categories.filter(item => item !== key)); setComparison(null);}} />{title}</label>)}</fieldset></section>

        {selected && <section className="snapshot-card"><h3>{KIND_LABELS[selected.kind]}快照：{selected.business_key}</h3>
          <p>质量：{QUALITY_LABELS[selected.quality]} · 来源：{snapshotSource(selected.provenance)}</p>
          <QueryTable headers={['字段', '该月快照', '当前资料', '字段来源']} rows={Object.entries(selected.payload).map(([key, item]) => [label(key), displayValue(item, key),
            displayValue(current?.payload[key], key), sourceDescription((selected.provenance.fields as Record<string, unknown> | undefined)?.[key])])} paginationKey={`${month}-${selected.kind}-${selected.business_key}`} />
          <div className="snapshot-toolbar"><label>修正字段<select value={field} disabled={writeDisabled} onChange={event => {setField(event.target.value); setValue(editText(selected.payload[event.target.value]));}}>
            {detail.editable_fields[selected.kind].map(key => <option key={key} value={key}>{label(key)}</option>)}</select></label>
            <label className="snapshot-edit-value">修正值{BOOLEAN_FIELDS.has(field) ? <select value={value} disabled={writeDisabled} onChange={event => setValue(event.target.value)}><option value="" disabled>未记录，请选择</option><option value="true">是</option><option value="false">否</option></select>
              : ENUMS[field] ? <select value={value} disabled={writeDisabled} onChange={event => setValue(event.target.value)}><option value="" disabled>未记录，请选择</option>{ENUMS[field].map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>
              : field === 'time_slots' ? <textarea value={value} disabled={writeDisabled} onChange={event => setValue(event.target.value)} />
              : <input type={field === 'resigned_at' ? 'date' : 'text'} value={value} disabled={writeDisabled} onChange={event => setValue(event.target.value)} />}</label>
            <button disabled={writeDisabled || !field || ((BOOLEAN_FIELDS.has(field) || !!ENUMS[field]) && !value)} onClick={correct}>预览修正</button></div>
          {field === 'time_slots' && <p className="snapshot-note">时段格式示例：{JSON.stringify([['08:00', '12:00'], ['13:00', '17:00']])}</p>}
          <p className="snapshot-note">修正仅影响该月份，记录字段来源，资料质量标记为“资料不完整”；当前主数据保持原值。</p>
        </section>}

        <section className="snapshot-card"><div className="snapshot-section-head"><h3>历史证据核对</h3><label><input type="checkbox" checked={inspectArchives} disabled={disabled}
          onChange={event => setInspectArchives(event.target.checked)} />读取归档文件证据</label></div>
          <p>日报、月报及菜票资料作为候选来源。冲突需逐项选择，系统不会自动采用。</p>
          <div className="snapshot-evidence">{detail.evidence.map(row => <fieldset key={evidenceKey(row.business_key, row.field)} disabled={writeDisabled}>
            <legend>{row.business_key} · {label(row.field)} {row.conflict && '（证据冲突）'}</legend>
            {row.candidates.map((candidate, index) => <label key={index}><input type="radio" name={evidenceKey(row.business_key, row.field)}
              aria-label={`${row.business_key} ${label(row.field)}：${displayBackupValue(candidate.value)}`} checked={evidenceChoices[evidenceKey(row.business_key, row.field)] === index}
              onChange={() => setEvidenceChoices({...evidenceChoices, [evidenceKey(row.business_key, row.field)]: index})} />
              <strong>{displayBackupValue(candidate.value)}</strong><span>{candidate.sources.map(source => `${SOURCE_LABELS[source.table] ?? '业务记录'}${source.source_filename ? `：${source.source_filename}` : source.id ? ` #${source.id}` : ''}`).join('；')}</span></label>)}
          </fieldset>)}</div>
          {!detail.evidence.length && <p>未找到可核对的历史证据。</p>}
          {!!detail.archives.length && <details><summary>归档读取情况</summary><ul>{detail.archives.map(row => <li key={row.id}>{row.source_filename}：{row.status === 'inspected' ? '已读取' : row.status === 'unreadable' ? '无法读取' : '尚未读取或不适用'}</li>)}</ul></details>}
          <div className="snapshot-toolbar"><button disabled={writeDisabled || !decisions.length} onClick={() => void compare({action: 'reconcile', decisions, categories, inspect_archives: inspectArchives})}>预览采用所选证据</button>
            <button disabled={disabled || !decisions.length} onClick={() => setEvidenceChoices({})}>清空证据选择</button></div>
        </section>
      </>}</div>
    </div>
    {comparison && <div className="snapshot-backdrop"><section ref={dialogRef} className="snapshot-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshot-confirm-title"
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) {event.preventDefault(); setComparison(null);}
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      }}>
      <h3 id="snapshot-confirm-title">确认快照变更</h3><p>月份：{comparison.preview.month} · 变更 {comparison.preview.changes.length} 条快照</p>
      {!!comparison.preview.required_categories.length && <p>影响业务：{comparison.preview.required_categories.map(key => CATEGORY_LABELS[key] ?? key).join('、')}</p>}
      <div className="snapshot-preview-list">{comparison.preview.changes.map(change => <article key={`${change.kind}-${change.business_key}`}><h4>{KIND_LABELS[change.kind]} {change.business_key} · {change.before ? '修正' : '补齐'}</h4>
        <dl>{Object.entries(change.after.payload).filter(([key, item]) => !change.before || JSON.stringify(item) !== JSON.stringify(change.before.payload[key])).map(([key, item]) => <div key={key}><dt>{label(key)}</dt><dd>{change.before && <>{displayValue(change.before.payload[key], key)} → </>}{displayValue(item, key)}</dd></div>)}</dl>
        <p>变更后质量：{QUALITY_LABELS[change.after.quality]}</p></article>)}</div>
      {!comparison.preview.changes.length && <p>没有需要写入的变更。</p>}
      <label className="snapshot-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />我已核对变更，并了解基线资料不代表已验证历史</label>
      <div className="snapshot-toolbar"><button className="snapshot-primary" disabled={busy || !acknowledged || !comparison.preview.changes.length} onClick={() => void apply()}>确认执行</button>
        <button disabled={busy} onClick={() => setComparison(null)}>取消</button></div>
    </section></div>}
  </main>;
}

function sourceDescription(source: unknown): string {
  if (source === 'baseline') return '当前资料基线';
  if (source === 'explicit_month_correction') return '管理员月内修正';
  if (source && typeof source === 'object' && 'source' in source && source.source === 'explicit_evidence_selection') return '明确选择历史证据';
  return source == null ? '未标明' : '已记录来源';
}

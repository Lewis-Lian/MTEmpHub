import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { uploadMonthlyBackup, refreshMonthlyBackupPreview, confirmMonthlyBackupRestore, cancelMonthlyBackupPreview,
  type BackupChoice, type RestoreSelection, type MonthlyBackupPreview, type MonthlyBackupRestoreResult, type MonthlyBackupRow, type BackupImportProgress } from '../../api/accountSetBackup';
import { BACKUP_CATEGORIES, DATASET_LABELS, STATUS_LABELS, QUALITY_LABELS, EXITS_CURRENT, rowLabel, fieldLabel, displayBackupValue, snapshotSource, humanBackupMessage } from './backupLabels';

const EMPTY_SELECTION: RestoreSelection = {months: [], categories: [], cross_month_keys: [], annual_keys: []};
const MONTH_CATEGORIES = ['account_settings', 'attendance', 'meal_tickets', 'meal_ledgers'];
const ARCHIVE_DATASETS = ['imports', 'meal_imports', 'meal_ledger_imports', 'meal_import_rows'];
function explicitScope(row: MonthlyBackupRow) { return row.scope.startsWith('cross_month/') ? 'cross_month_keys' : row.scope.startsWith('year/') ? 'annual_keys' : null; }
function selectedScope(row: MonthlyBackupRow, selection: RestoreSelection) {
  const categorySelected = row.dataset === 'snapshots' ? selection.categories.some(category => MONTH_CATEGORIES.includes(category)) : selection.categories.includes(row.category);
  const keyScope = explicitScope(row);
  return categorySelected && (!row.month || selection.months.includes(row.month)) && (!keyScope || selection[keyScope].includes(row.row_key)) && (!ARCHIVE_DATASETS.includes(row.dataset) || selection.categories.includes('archives'));
}

export default function AccountSetBackupModal({onClose, onRestored, onReauthenticate = () => window.location.assign('/login')}: {
  onClose: () => void; onRestored: (result: MonthlyBackupRestoreResult) => void | Promise<void>; onReauthenticate?: () => void;
}) {
  const [preview, setPreview] = useState<MonthlyBackupPreview | null>(null);
  const [selection, setSelection] = useState<RestoreSelection>(EMPTY_SELECTION);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, BackupChoice>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupImportProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<MonthlyBackupRestoreResult | null>(null);
  const [cacheWarning, setCacheWarning] = useState('');
  const notifiedTask = useRef('');
  const [filters, setFilters] = useState({month: '', category: '', status: '', keyword: ''});
  const [limit, setLimit] = useState(100);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const generation = useRef(0);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // The result is committed to the screen before any authenticated reload.
  useEffect(() => {
    if (!result || result.reauthentication_required || notifiedTask.current === result.task_id) return;
    notifiedTask.current = result.task_id;
    Promise.resolve().then(() => onRestored(result)).catch(() => setCacheWarning('恢复已成功，缓存刷新失败，请关闭后重新加载页面。'));
  }, [result, onRestored]);

  async function refresh(nextSelection = selection, nextChoices = choices) {
    if (!preview) return;
    const requestGeneration = ++generation.current;
    setBusy(true); setValid(false); setError(''); setConfirming(false);
    try {
      const next = await refreshMonthlyBackupPreview(preview.token, nextSelection, nextChoices);
      if (generation.current === requestGeneration) {
        setPreview(next); setValid(true);
        setChecked(current => new Set([...current].filter(key => next.rows.some(row => row.row_key === key && row.enabled))));
      }
    } catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : '预览失败'); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  async function upload(file: File) {
    if (busy) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('请选择 ZIP 格式的账套备份'); return; }
    if (file.size > 100 * 1024 * 1024) { setError('ZIP 备份不能超过 100 MiB'); return; }
    setBusy(true); setError('');
    setProgress({status:'running', phase:'upload', stage:'上传备份文件', percent:0, completed:0, total:file.size});
    try {
      const next = await uploadMonthlyBackup(file, setProgress);
      setPreview(next); setSelection(next.selection); setAvailableMonths(next.selection.months); setAvailableCategories(next.selection.categories); setValid(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '上传失败'); }
    finally { setBusy(false); setProgress(null); }
  }
  function changeSelection(next: RestoreSelection) {
    // Disabled rows cannot be submitted as explicit choices to the server.
    const allowed = new Set(preview?.rows.filter(row => selectedScope(row, next) && preview.coverage[row.scope]?.included).map(row => row.row_key));
    const nextChoices = Object.fromEntries(Object.entries(choices).filter(([key]) => allowed.has(key)));
    setSelection(next); setChoices(nextChoices); setChecked(current => new Set([...current].filter(key => allowed.has(key))));
    void refresh(next, nextChoices);
  }
  function choose(key: string, choice: BackupChoice) { const next = {...choices, [key]: choice}; setChoices(next); void refresh(selection, next); }
  function bulk(choice: BackupChoice) {
    const next = {...choices};
    const selected = preview?.rows.filter(row => row.enabled && checked.has(row.row_key)) ?? [];
    const allowed = selected.filter(row => choice !== 'backup' || row.status !== 'system_only' || preview?.coverage[row.scope]?.complete);
    if (!allowed.length) { setError('不完整范围的系统独有记录不能按缺失删除，请保留系统或跳过。'); return; }
    allowed.forEach(row => { next[row.row_key] = choice; });
    setChoices(next); void refresh(selection, next);
  }
  async function restore() {
    if (!preview || !valid || preview.blockers.length) return;
    setBusy(true); setError('');
    try {
      const restored = await confirmMonthlyBackupRestore(preview.token, {selection, choices, fingerprint: preview.fingerprint});
      setResult(restored); setConfirming(false);
    } catch (caught) {
      setConfirming(false); setValid(false);
      setError(caught instanceof ApiError && caught.status === 409 ? '系统数据已变化，请重新比较并检查差异后确认。' : caught instanceof Error ? caught.message : '恢复失败，请调整选择后重新预览。');
    } finally { setBusy(false); }
  }
  async function close() {
    if (busy) return;
    if (result?.reauthentication_required) { onReauthenticate(); return; }
    if (preview && !result) { try { await cancelMonthlyBackupPreview(preview.token); } catch { /* Expired tasks are cleaned by the server. */ } }
    onClose();
  }
  function filter(key: keyof typeof filters, value: string) { setFilters({...filters, [key]: value}); setLimit(100); }
  const filtered = preview?.rows.filter(row => (!filters.month || row.month === filters.month || row.affected_months.includes(filters.month)) && (!filters.category || row.category === filters.category) && (!filters.status || row.status === filters.status) && (!filters.keyword || `${rowLabel(row)} ${row.month ?? row.year ?? ''}`.toLowerCase().includes(filters.keyword.toLowerCase()))) ?? [];
  const shown = filtered.slice(0, limit);
  const selectable = filtered.filter(row => row.enabled);
  const hiddenCount = [...checked].filter(key => !shown.some(row => row.row_key === key)).length;
  const changes = preview?.rows.filter(row => row.enabled && row.status !== 'same' && (choices[row.row_key] ?? row.choice ?? row.default_choice) === 'backup') ?? [];
  const exiting = changes.filter(row => row.status === 'system_only' && EXITS_CURRENT.has(row.dataset));
  const deleting = changes.filter(row => row.status === 'system_only' && !EXITS_CURRENT.has(row.dataset));
  const outside = changes.filter(row => explicitScope(row) || row.affected_months.some(month => !selection.months.includes(month)));
  function blockers() {
    return !!preview?.blockers.length && <div role="alert" className="backup-error">{preview.blockers.map((item, index) => <div key={index}><p>{humanBackupMessage(item.message)}</p>
      {item.row_key && <p>相关记录：{preview.rows.find(row => row.row_key === item.row_key) ? rowLabel(preview.rows.find(row => row.row_key === item.row_key)!) : '所选业务记录'}</p>}
      {!!item.required_rows?.length && <p>需要一并选择：{item.required_rows.map(key => {const row = preview.rows.find(row => row.row_key === key); return row ? rowLabel(row) : '依赖记录（请核对所选范围）';}).join('、')}</p>}
    </div>)}</div>;
  }
  function removalList(title: string, list: MonthlyBackupRow[]) { return !!list.length && <><h4>{title}清单</h4><ul>{list.map(row => <li key={row.row_key}>{rowLabel(row)}{row.month && `（${row.month}）`}</li>)}</ul></>; }

  return <div className="acm-modal-backdrop"><div className="acm-modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
    <div className="acm-modal-head"><div className="backup-heading"><div><h3 id="backup-title">导入月度账套</h3><p>识别多月份备份，选择范围并核对差异后恢复</p></div></div><button className="acm-modal-close-btn" disabled={busy} aria-label="关闭备份导入" onClick={() => void close()}>×</button></div>
    <div className="acm-modal-body">
      <ol className="backup-steps" aria-label="导入步骤">{['选择备份', '核对差异', '确认恢复'].map((label, index) => <li key={label} className={index === (result || confirming ? 2 : preview ? 1 : 0) ? 'is-current' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
      {error && <p role="alert" className="backup-error">{error}</p>}
      {busy && <div className="backup-processing" role="status"><span className="backup-processing-spinner" aria-hidden="true" />
        {progress ? <div className="backup-processing-copy"><strong>{progress.stage}</strong>
          <p>{(progress.total ?? 0) > 0 && `${(progress.completed ?? 0).toLocaleString()} / ${progress.total!.toLocaleString()} ${['upload', 'unpacking'].includes(progress.phase ?? '') ? '字节' : progress.phase === 'completed' ? '项' : '条记录'} · `}
            已耗时 {elapsed} 秒{progress.percent !== null && ` · 当前阶段 ${Math.floor(progress.percent)}%`}</p>
          <progress className="backup-import-progress" aria-label="当前阶段进度" max={100} value={progress.percent ?? undefined} />
        </div> : <p>{confirming ? '正在恢复账套数据' : preview ? '正在重新核对差异' : '正在上传并解析备份'}</p>}
      </div>}
      {!preview && <div className={`backup-upload-zone${dragging ? ' is-dragging' : ''}`} role="region" aria-label="上传账套备份" aria-busy={busy}
        onDragEnter={event => {event.preventDefault(); if (!busy && event.dataTransfer.types.includes('Files')) {dragDepth.current++; setDragging(true);}}}
        onDragOver={event => {event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy';}}
        onDragLeave={event => {event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);}}
        onDrop={event => {event.preventDefault(); dragDepth.current = 0; setDragging(false); if (busy) return; const files = event.dataTransfer.files; if (files.length > 1) setError('请每次上传一个账套备份'); else if (files[0]) void upload(files[0]);}}>
        <h4>选择包含一个或多个月份的账套备份</h4><p>将 ZIP 备份拖入此处，或点击下方选择文件</p><label className="backup-file-picker">选择账套备份<input type="file" accept=".zip" disabled={busy} onChange={event => {const file = event.target.files?.[0]; if (file) void upload(file);}} /></label><span className="backup-upload-hint">兼容旧版单月备份，最大 100 MiB；先预览，后恢复。</span>
      </div>}
      {preview && !result && <>
        {!confirming && <>
          <fieldset disabled={busy} className="backup-options"><legend>识别到的月份</legend>{availableMonths.map(month => <label key={month}><input aria-label={`恢复月份 ${month}`} type="checkbox" checked={selection.months.includes(month)} onChange={event => changeSelection({...selection, months: event.target.checked ? [...selection.months, month] : selection.months.filter(value => value !== month)})} />{month}</label>)}</fieldset>
          <fieldset disabled={busy} className="backup-options"><legend>实际包含的类别</legend>{Object.entries(BACKUP_CATEGORIES).map(([key, label]) => <label key={key}><input aria-label={`恢复类别 ${label}`} type="checkbox" disabled={!availableCategories.includes(key)} checked={selection.categories.includes(key)} onChange={event => changeSelection({...selection, categories: event.target.checked ? [...selection.categories, key] : selection.categories.filter(value => value !== key), cross_month_keys: key === 'cross_month' && !event.target.checked ? [] : selection.cross_month_keys, annual_keys: key === 'annual_stats' && !event.target.checked ? [] : selection.annual_keys})} />{label}{!availableCategories.includes(key) && '（未包含）'}</label>)}</fieldset>
          <details className="backup-coverage"><summary>备份覆盖范围与完整性</summary><ul>{Object.entries(preview.coverage).map(([scope, coverage]) => {const parts = scope.split('/'); return <li key={scope}>{parts[0] === 'month' ? `${parts[1]} ` : parts[0] === 'year' ? `${parts[1]} 年 ` : parts[0] === 'cross_month' ? '跨月 ' : '当前 '}{DATASET_LABELS[parts[parts.length - 1]] ?? '业务资料'}：{coverage.included ? '已包含（included）' : '未包含（absent）'}，{coverage.complete ? '完整（complete）' : '不完整（incomplete）'}</li>;})}</ul></details>
          <p className="backup-scope-note">未包含或不完整的范围不能按缺失删除。旧包的关联资料只是子集；“未包含”不等于“空且完整”。未选月份和类别不会恢复。新增和冲突默认采用备份，完整所选范围的系统独有默认不保留。</p>
          <p>跨月及年度资料须逐条勾选“恢复条目”，只选大类别不会自动选择条目。下方“勾选”只用于批量设置采用方式。</p>
          <div className="backup-toolbar">
            <label>筛选月份<select value={filters.month} onChange={event => filter('month', event.target.value)}><option value="">全部月份</option>{availableMonths.map(month => <option key={month}>{month}</option>)}</select></label>
            <label>筛选类别<select value={filters.category} onChange={event => filter('category', event.target.value)}><option value="">全部类别</option>{Object.entries(BACKUP_CATEGORIES).map(([key,label]) => <option value={key} key={key}>{label}</option>)}<option value="monthly_references">月度历史资料快照</option></select></label>
            <label>筛选状态<select value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label>关键词<input value={filters.keyword} onChange={event => filter('keyword', event.target.value)} placeholder="编号、姓名或月份" /></label>
          </div>
          <div className="backup-toolbar"><button disabled={busy || !selectable.length} onClick={() => setChecked(current => new Set([...current, ...selectable.map(row => row.row_key)]))}>勾选筛选结果（{selectable.length} 条）</button><button disabled={busy || !checked.size} onClick={() => setChecked(new Set())}>取消全部勾选</button>
            <button disabled={busy || !checked.size} onClick={() => bulk('backup')}>所选行采用备份</button><button disabled={busy || !checked.size} onClick={() => bulk('system')}>所选行保留系统</button><button disabled={busy || !checked.size} onClick={() => bulk('skip')}>所选行跳过</button>
          </div><p aria-live="polite">已勾选 {checked.size} 条，其中隐藏 {hiddenCount} 条</p>
          <div className="backup-summary">{Object.entries(STATUS_LABELS).map(([key,label]) => <div className={`backup-summary-item backup-summary-item--${key}`} key={key}><span>{label}</span><strong>{preview.summary[key as keyof typeof STATUS_LABELS]}</strong></div>)}</div>
          <div className="backup-differences">{shown.map(row => {
            const keyScope = explicitScope(row); const label = rowLabel(row); const coverage = preview.coverage[row.scope];
            return <div className={`backup-difference-card backup-difference-card--${row.status}${!row.enabled ? ' backup-disabled' : ''}`} key={row.row_key}>
              <div className="backup-row-controls"><label><input type="checkbox" aria-label={`勾选 ${label}`} disabled={busy || !row.enabled} checked={checked.has(row.row_key)} onChange={event => setChecked(current => {const next = new Set(current); if (event.target.checked) next.add(row.row_key); else next.delete(row.row_key); return next;})} />勾选</label>
                {keyScope && <label><input type="checkbox" aria-label={`恢复条目 ${label}`} disabled={busy || !selection.categories.includes(row.category) || !coverage?.included} checked={selection[keyScope].includes(row.row_key)} onChange={event => changeSelection({...selection,[keyScope]: event.target.checked ? [...selection[keyScope],row.row_key] : selection[keyScope].filter(key => key !== row.row_key)})} />恢复条目</label>}
                <span>{label}</span><span>{row.month ?? (row.year ? `${row.year} 年` : '共享 / 跨月')}</span><span className={`backup-row-status backup-row-status--${row.status}`}>{STATUS_LABELS[row.status]}</span>{!row.enabled && <span>未选恢复</span>}
              </div>
              <p>影响月份：{row.affected_months.join('、') || '当前资料'}{row.year && '（全年）'}</p>
              {row.reference_quality && <p>快照来源质量：系统 {QUALITY_LABELS[row.reference_quality.system] ?? '待核对'}；备份 {QUALITY_LABELS[row.reference_quality.backup] ?? '待核对'}</p>}
              {row.dataset === 'snapshots' && <p>备份快照来源：{snapshotSource(row.backup?.provenance)}</p>}
              {row.dataset === 'users' && <p>密码：{row.password_changed ? '不同' : '一致'}</p>}
              <label>采用方式<select aria-label={`采用方式 ${label}`} disabled={busy || !row.enabled} value={choices[row.row_key] ?? row.choice ?? row.default_choice} onChange={event => choose(row.row_key, event.target.value as BackupChoice)}>
                <option value="backup" disabled={row.status === 'system_only' && (!coverage?.included || !coverage.complete)}>{row.status === 'system_only' ? EXITS_CURRENT.has(row.dataset) ? '按备份退出当前资料' : '按备份删除业务记录' : '采用备份'}</option><option value="system">{row.status === 'new' ? '不新增' : '保留系统'}</option><option value="skip">跳过</option>
              </select></label>
              {!!row.fields.length && <details open={expanded.has(row.row_key)} onToggle={event => {const open = event.currentTarget.open; setExpanded(current => {if (current.has(row.row_key) === open) return current; const next = new Set(current); if (open) next.add(row.row_key); else next.delete(row.row_key); return next;});}}><summary>查看字段差异（{row.fields.length} 项）</summary>{expanded.has(row.row_key) && <div className="backup-table-wrap"><table><thead><tr><th>字段</th><th>系统值</th><th>备份值</th><th>差额</th></tr></thead><tbody>{row.fields.filter(field => field.name !== 'password_changed' && field.name !== 'password_hash').map(field => <tr key={field.name}><td>{fieldLabel(field)}</td><td>{displayBackupValue(field.system, field.name)}</td><td>{displayBackupValue(field.backup, field.name)}</td><td>{field.delta == null ? '—' : field.delta}</td></tr>)}</tbody></table></div>}</details>}
            </div>;
          })}</div>
          {filtered.length > limit && <button disabled={busy} onClick={() => setLimit(limit + 100)}>显示更多差异</button>}
          {blockers()}
          <div className="backup-toolbar backup-footer"><button disabled={busy} onClick={() => void refresh()}>重新预览</button><button className="backup-primary-btn" disabled={busy || !valid} onClick={() => setConfirming(true)}>查看导入确认</button></div>
        </>}
        {confirming && <>
          <div className="backup-confirm-card"><h4>确认将执行的变更</h4><p>恢复月份：{selection.months.join('、') || '仅共享及明确条目'}；类别：{selection.categories.map(key => BACKUP_CATEGORIES[key]).join('、')}</p><div className="backup-confirm-counts">{[['新增记录',changes.filter(row => row.status === 'new').length],['更新记录',changes.filter(row => row.status === 'changed').length],['退出当前资料',exiting.length],['删除业务记录',deleting.length]].map(([label,count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div></div>
          <p>退出当前资料保留本地身份及历史引用；删除业务记录会移除所选范围中的业务数据。</p>
          {removalList('退出当前资料',exiting)}{removalList('删除业务记录',deleting)}
          {!!outside.length && <><h4>跨月 / 年度影响</h4><ul>{outside.map(row => <li key={row.row_key}>{rowLabel(row)}：影响 {row.affected_months.join('、') || '当前资料'}{row.year && '（全年）'}</li>)}</ul></>}
          {blockers()}
          <p className="backup-scope-note">系统会再次检查目标变化、依赖和实际锁定月份；失败时整次回滚。菜票仅恢复本地记录，不会重放充值或扣款。</p>
          <div className="backup-toolbar backup-footer"><button disabled={busy} onClick={() => setConfirming(false)}>返回修改</button><button className="backup-primary-btn" disabled={busy || !valid || !!preview.blockers.length} onClick={() => void restore()}>确认导入</button></div>
        </>}
      </>}
      {result && <div className="backup-result"><h4>账套恢复完成</h4><p>月份：{result.months.join('、')}</p><div className="backup-result-counts">{[['新增',result.counts.new],['更新',result.counts.updated],['退出或删除',result.counts.deleted],['保留或跳过',result.counts.skipped]].map(([label,count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
        {Object.entries(result.category_counts).map(([category,counts]) => <p key={category}>{BACKUP_CATEGORIES[category] ?? '月度历史资料'}：新增 {counts.new}，更新 {counts.updated}，退出或删除 {counts.deleted}</p>)}
        {result.warnings.map(message => <p key={message}>{message}</p>)}{cacheWarning && <p role="alert">{cacheWarning}</p>}
        {result.reauthentication_required ? <><p>本次恢复更新了您的账号或权限，请核对结果后重新登录。</p><button className="backup-primary-btn" onClick={onReauthenticate}>重新登录</button></> : <button className="backup-primary-btn" onClick={() => void close()}>完成</button>}
      </div>}
    </div>
  </div></div>;
}

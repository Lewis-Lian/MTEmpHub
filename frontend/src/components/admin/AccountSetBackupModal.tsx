import { useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { uploadBackup, refreshBackupPreview, confirmBackupRestore, cancelBackupPreview,
  type BackupChoice, type BackupOptions, type BackupPreview, type BackupRestoreResult } from '../../api/accountSetBackup';

const DEFAULT_OPTIONS: BackupOptions = {employees: false, departments: false, shifts: false, annual_stats: false, delete_month_only: false};
const CATEGORIES: Record<string, string> = {
  account_set: '账套参数', employees: '员工资料', departments: '部门资料', shifts: '班次资料',
  employee_shift_assignments: '员工默认班次', factory_rest: '厂休', daily_records: '日报', monthly_reports: '月报',
  leave_records: '请假单', overtime_records: '加班单', daily_overrides: '逐日修正', employee_overrides: '员工月度修正',
  manager_overrides: '管理人员月度修正', annual_leave: '年度年假余额', manager_stats: '管理人员年度统计',
  override_history: '修正历史', sync_history: '同步历史', imports: '原始文件',
};
const STATUS = {new: '备份新增', changed: '值不一致', system_only: '系统独有', same: '一致'};
const DELETE_CATEGORIES = new Set(['factory_rest', 'daily_records', 'monthly_reports', 'daily_overrides', 'employee_overrides', 'manager_overrides', 'imports']);
function identityLabel(value: string): string {
  try { const parts: unknown = JSON.parse(value); return Array.isArray(parts) ? parts.filter(part => part !== 'slot' && part !== 'filename').join(' · ') : value; }
  catch { return value; }
}
function display(value: unknown): string { return value === null || value === undefined ? '空' : typeof value === 'object' ? JSON.stringify(value) : String(value); }

export default function AccountSetBackupModal({onClose, onRestored}: {onClose: () => void; onRestored: (id: number) => void}) {
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [choices, setChoices] = useState<Record<string, BackupChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BackupRestoreResult | null>(null);
  const [category, setCategory] = useState('');
  const [showSame, setShowSame] = useState(false);
  const generation = useRef(0);
  const [valid, setValid] = useState(false);

  async function refresh(nextOptions: BackupOptions, nextChoices: Record<string, BackupChoice>) {
    if (!preview) return;
    const requestGeneration = ++generation.current;
    setBusy(true); setValid(false); setError(''); setConfirming(false);
    try {
      const next = await refreshBackupPreview(preview.token, nextOptions, nextChoices);
      if (generation.current === requestGeneration) { setPreview(next); setValid(true); }
    } catch (caught) {
      if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : '预览失败');
    } finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setError('');
    try { setPreview(await uploadBackup(file)); setValid(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '上传失败'); }
    finally { setBusy(false); }
  }
  function choose(key: string, choice: BackupChoice) {
    const next = {...choices, [key]: choice}; setChoices(next); void refresh(options, next);
  }
  function bulk(choice: BackupChoice) {
    const next = {...choices};
    preview?.rows.filter(row => row.enabled && row.status === 'changed').forEach(row => {next[row.key] = choice;});
    setChoices(next); void refresh(options, next);
  }
  async function restore() {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const restored = await confirmBackupRestore(preview.token, {options, choices, fingerprint: preview.fingerprint});
      setResult(restored); setConfirming(false); onRestored(restored.account_set_id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConfirming(false); setChoices({}); setValid(false);
        try { setPreview(await refreshBackupPreview(preview.token, options, {})); setValid(true); }
        catch { /* Keep confirmation disabled until a fresh preview succeeds. */ }
        setError('系统数据已变化，已返回预览，请重新检查差异后确认。');
      } else { setConfirming(false); setValid(false); setError(caught instanceof Error ? caught.message : '恢复失败'); }
    } finally { setBusy(false); }
  }
  async function close() {
    if (preview && !result) {
      try { await cancelBackupPreview(preview.token); } catch { /* Expired tasks are cleaned by the server. */ }
    }
    onClose();
  }
  const changed = preview?.rows.filter(row => row.enabled && row.status !== 'same' && (choices[row.key] ?? row.default_choice) === 'backup') ?? [];
  const deleting = changed.filter(row => row.status === 'system_only');
  const adding = changed.filter(row => row.status === 'new');
  const updating = changed.filter(row => row.status === 'changed');
  const shown = preview?.rows.filter(row => (!category || row.dataset === category) && (showSame || row.status !== 'same')) ?? [];

  return <div className="acm-modal-backdrop"><div className="acm-modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
    <div className="acm-modal-head"><div className="backup-heading"><span className="backup-heading-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg></span><div><h3 id="backup-title">导入月度账套</h3><p>一个备份对应一个月份，核对差异后恢复</p></div></div><button className="acm-modal-close-btn" type="button" disabled={busy} aria-label="关闭备份导入" onClick={() => void close()}>×</button></div>
    <div className="acm-modal-body">
      <ol className="backup-steps" aria-label="导入步骤">{['选择备份', '核对差异', '确认恢复'].map((label, index) => <li key={label} className={index === (result || confirming ? 2 : preview ? 1 : 0) ? 'is-current' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
      {error && <p role="alert" className="backup-error">{error}</p>}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {!preview && <div className="backup-upload-zone"><span className="backup-upload-icon" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6v20h12V6zM14 2v5h5M9 12h6m-6 4h6" /></svg></span><h4>选择一个月份的账套备份</h4><p>支持完整 ZIP 备份，上传后自动识别账套月份</p><label className="backup-file-picker">选择账套备份<input type="file" accept=".zip" disabled={busy} onChange={event => {const file = event.target.files?.[0]; if (file) void upload(file);}} /></label><span className="backup-upload-hint">先预览差异，再选择采用的数据</span></div>}
      {preview && !result && <>
        <h4 className="backup-month-badge">{preview.month} 账套备份</h4>
        {preview.source_locked && <p>来源账套已锁定；导入不会改变系统中的锁定状态。</p>}
        {!confirming && <>
          <fieldset disabled={busy} className="backup-options"><legend>选择导入关联资料（可选）</legend>
            {([['employees', '员工资料'], ['departments', '部门资料'], ['shifts', '班次及默认分配'], ['annual_stats', '年度统计及年假余额']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} onChange={event => {const next = {...options, [key]: event.target.checked}; setOptions(next); setChoices({}); void refresh(next, {});}} />{label}</label>)}
          </fieldset>
          <p>共享资料会影响其他月份；年度资料会影响全年。未勾选时沿用系统资料，缺失引用需先补齐。</p>
          <label><input type="checkbox" disabled={busy} checked={options.delete_month_only} onChange={event => {const next = {...options, delete_month_only: event.target.checked}; setOptions(next); setChoices({}); void refresh(next, {});}} />使当月独有数据与备份一致（删除清单将在确认页展示）</label>
          <div className="backup-toolbar">
            <label>数据类别<select value={category} onChange={event => setCategory(event.target.value)}><option value="">全部</option>{Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><input type="checkbox" checked={showSame} onChange={event => setShowSame(event.target.checked)} />显示一致记录</label>
            <button type="button" disabled={busy} onClick={() => bulk('system')}>冲突以系统为准</button>
            <button type="button" disabled={busy} onClick={() => bulk('backup')}>冲突以备份为准</button>
          </div>
          <div className="backup-summary">{([['new', '备份新增'], ['changed', '值不一致'], ['system_only', '系统独有'], ['same', '数据一致']] as const).map(([key, label]) => <div className={`backup-summary-item backup-summary-item--${key}`} key={key}><span>{label}</span><strong>{preview.summary[key]}</strong></div>)}</div>
          <div className="backup-differences">{shown.map(row => <details key={row.key} open={row.status === 'changed'} className={`backup-difference-card backup-difference-card--${row.status}${!row.enabled ? ' backup-disabled' : ''}`}>
            <summary>{CATEGORIES[row.dataset]} · {identityLabel(row.identity)} · {STATUS[row.status]}{!row.enabled && '（未选导入）'}</summary>
            <p>影响月份：{row.affected_months.join('、') || preview.month}</p>
            {row.status !== 'same' && <label>采用方式<select aria-label={`采用方式 ${row.key}`} disabled={busy || !row.enabled} value={choices[row.key] ?? row.default_choice} onChange={event => choose(row.key, event.target.value as BackupChoice)}>
              <option value="system">{row.status === 'new' ? '不新增' : '以系统为准'}</option>
              {(row.status !== 'system_only' || (options.delete_month_only && DELETE_CATEGORIES.has(row.dataset))) && <option value="backup">{row.status === 'system_only' ? '按备份删除该记录' : '以备份为准'}</option>}
              <option value="skip">跳过</option>
            </select></label>}
            {!!row.fields.length && <div className="backup-table-wrap"><table><thead><tr><th>字段</th><th>系统值</th><th>备份值</th><th>差额</th></tr></thead><tbody>{row.fields.map(field => <tr key={field.name}><td>{field.label}</td><td>{display(field.system)}</td><td>{display(field.backup)}</td><td>{field.delta === null ? '—' : field.delta}</td></tr>)}</tbody></table></div>}
          </details>)}</div>
          {!!preview.blockers.length && <div role="alert" className="backup-error">{preview.blockers.map(item => <p key={item.message}>{item.message}</p>)}</div>}
          <div className="backup-toolbar backup-footer"><button type="button" disabled={busy} onClick={() => void refresh(options, choices)}>重新预览</button><button className="backup-primary-btn" type="button" disabled={busy || !valid || !!preview.blockers.length} onClick={() => setConfirming(true)}>查看导入确认</button></div>
        </>}
        {confirming && <>
          <h4>确认将执行的变更</h4><p>新增 {adding.length} 条，更新 {updating.length} 条，删除 {deleting.length} 条。</p>
          <ul>{changed.filter(row => row.affected_months.some(month => month !== preview.month) || ['annual_leave', 'manager_stats'].includes(row.dataset)).map(row => <li key={row.key}>{CATEGORIES[row.dataset]} {identityLabel(row.identity)}：影响 {row.affected_months.join('、') || '全年'}{['annual_leave', 'manager_stats'].includes(row.dataset) && '（全年）'}</li>)}</ul>
          {!!deleting.length && <><h4>删除清单</h4><ul>{deleting.map(row => <li key={row.key}>{CATEGORIES[row.dataset]} {identityLabel(row.identity)}</li>)}</ul></>}
          <p>请确认上述选择。系统会再次检查差异；失败时回滚本次数据变更。</p>
          <div className="backup-toolbar backup-footer"><button type="button" disabled={busy} onClick={() => setConfirming(false)}>返回修改</button><button className="backup-primary-btn" type="button" disabled={busy || !valid} onClick={() => void restore()}>确认导入</button></div>
        </>}
      </>}
      {result && <div className="backup-result"><span className="backup-result-icon" aria-hidden="true">✓</span><h4>账套恢复完成</h4><p>新增 {result.counts.new} · 更新 {result.counts.updated} · 删除 {result.counts.deleted} · 保留或跳过 {result.counts.skipped}</p>{result.warnings.map(message => <p key={message}>{message}</p>)}<button className="backup-primary-btn" type="button" onClick={() => void close()}>完成</button></div>}
    </div>
  </div></div>;
}

import { useEffect, useState } from 'react';
import { downloadMonthlyBackup, type BackupExportProgress } from '../../api/accountSetBackup';
import { BACKUP_CATEGORIES } from './backupLabels';

export default function MonthlyBackupExportModal({accountSets, initialId, onClose}: {
  accountSets: Array<{id: number; month: string}>; initialId?: number | null; onClose: () => void;
}) {
  const [ids, setIds] = useState<number[]>(initialId ? [initialId] : []);
  const selectedIds = ids.filter(id => accountSets.some(account => account.id === id));
  const [categories, setCategories] = useState(Object.keys(BACKUP_CATEGORIES).filter(key => key !== 'archives'));
  const [progress, setProgress] = useState<BackupExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  async function download() {
    setBusy(true); setError(''); setElapsed(0);
    setProgress({status: 'running', percent: null, stage: '等待服务器准备备份'});
    try { await downloadMonthlyBackup(selectedIds, categories, setProgress); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '导出失败'); }
    finally { setBusy(false); }
  }
  const receiving = progress?.phase === 'download' && progress.total === undefined && progress.status !== 'completed';
  const indeterminate = progress?.percent == null || receiving;
  return <div className="acm-modal-backdrop"><div className="acm-modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <div className="acm-modal-head"><h3 id="export-title">导出多月份备份</h3><button className="acm-modal-close-btn" disabled={busy} aria-label="关闭备份导出" onClick={onClose}>×</button></div>
    <div className="acm-modal-body">
      <fieldset className="backup-options" disabled={busy}><legend>选择导出月份</legend>
        {accountSets.map(account => <label key={account.id}><input type="checkbox" checked={ids.includes(account.id)} onChange={event => setIds(event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} />{account.month}</label>)}
      </fieldset>
      <p>已选月份：{accountSets.filter(account => ids.includes(account.id)).map(account => account.month).join('、') || '尚未选择'}</p>
      <fieldset className="backup-options" disabled={busy}><legend>导出数据（默认全部）</legend>{Object.entries(BACKUP_CATEGORIES).filter(([key]) => key !== 'archives').map(([key, label]) => <label key={key}><input type="checkbox" checked={categories.includes(key)} onChange={event => setCategories(event.target.checked ? [...categories, key] : categories.filter(item => item !== key))} />{label}</label>)}</fieldset>
      <p className="backup-scope-note">当前部门、员工、班次及账号按完整当前资料导出，不局限于所选月有业务记录的人员。月份业务携带历史资料快照；账号包含密码和权限，请妥善保存备份。</p>
      <p>保留业务数据、导入记录和当月人员资料，不附带导入时的原始文件。</p>
      <p>ZIP 备份上传限制为 100 MiB。超限请减少导出月份或内容后重试。</p>
      {error && <p role="alert" className="backup-error">{error}</p>}
      {progress && <div className="acm-export-progress" role="status"><div className="acm-export-progress-heading"><span>{progress.stage}</span><strong>{receiving ? '接收中' : indeterminate ? '处理中' : `${Math.floor(progress.percent ?? 0)}%`}</strong></div>
        <div className={`acm-export-progress-track${indeterminate ? ' acm-export-progress-track--indeterminate' : ''}`} role="progressbar" aria-label="账套导出当前阶段进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : progress.percent ?? undefined}><span style={indeterminate ? undefined : {width: `${progress.percent}%`}} /></div>
        {progress.unit === 'records' && progress.completed !== undefined && progress.total !== undefined && progress.total > 0 && <p>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()} 条记录</p>}
        <p>{indeterminate ? '当前阶段处理中，暂无法计算完成比例' : '显示当前阶段的实际完成进度'}{busy && ` · 已用时 ${elapsed} 秒`}</p>
      </div>}
      <div className="backup-toolbar backup-footer"><button className="backup-primary-btn" disabled={busy || !selectedIds.length || !categories.length} onClick={() => void download()}>开始导出</button><button disabled={busy} onClick={onClose}>关闭</button></div>
    </div>
  </div></div>;
}

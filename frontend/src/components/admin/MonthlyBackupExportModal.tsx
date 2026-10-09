import { useState } from 'react';
import { downloadMonthlyBackup, type BackupExportProgress } from '../../api/accountSetBackup';
import { BACKUP_CATEGORIES } from './backupLabels';

export default function MonthlyBackupExportModal({accountSets, initialId, onClose}: {
  accountSets: Array<{id: number; month: string}>; initialId?: number | null; onClose: () => void;
}) {
  const [ids, setIds] = useState<number[]>(initialId ? [initialId] : []);
  const [categories, setCategories] = useState(Object.keys(BACKUP_CATEGORIES));
  const [progress, setProgress] = useState<BackupExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true); setError(''); setProgress(null);
    try { await downloadMonthlyBackup(ids, categories, setProgress); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '导出失败'); }
    finally { setBusy(false); }
  }
  const receiving = progress?.phase === 'download' && progress.total === undefined && progress.status !== 'completed';
  return <div className="acm-modal-backdrop"><div className="acm-modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <div className="acm-modal-head"><h3 id="export-title">导出多月份备份</h3><button className="acm-modal-close-btn" disabled={busy} aria-label="关闭备份导出" onClick={onClose}>×</button></div>
    <div className="acm-modal-body">
      <fieldset className="backup-options" disabled={busy}><legend>选择导出月份</legend>
        {accountSets.map(account => <label key={account.id}><input type="checkbox" checked={ids.includes(account.id)} onChange={event => setIds(event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} />{account.month}</label>)}
      </fieldset>
      <p>已选月份：{accountSets.filter(account => ids.includes(account.id)).map(account => account.month).join('、') || '尚未选择'}</p>
      <fieldset className="backup-options" disabled={busy}><legend>导出内容（默认全部）</legend>{Object.entries(BACKUP_CATEGORIES).map(([key, label]) => <label key={key}><input type="checkbox" checked={categories.includes(key)} onChange={event => setCategories(event.target.checked ? [...categories, key] : categories.filter(item => item !== key))} />{label}</label>)}</fieldset>
      <p className="backup-scope-note">当前部门、员工、班次及账号按完整当前资料导出，不局限于所选月有业务记录的人员。月份业务携带历史资料快照；账号包含密码和权限，请妥善保存备份。</p>
      <p>ZIP 备份上传限制为 100 MiB。超限请减少导出月份或内容后重试。</p>
      {error && <p role="alert" className="backup-error">{error}</p>}
      {progress && <div className="acm-export-progress" role="status"><div className="acm-export-progress-heading"><span>{progress.stage}</span><strong>{receiving ? '接收中' : `${progress.percent}%`}</strong></div>
        <div className="acm-export-progress-track" role="progressbar" aria-label="账套导出当前阶段进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={receiving ? undefined : progress.percent}><span style={{width: `${progress.percent}%`}} /></div><p>显示当前阶段的实际完成进度</p>
      </div>}
      <div className="backup-toolbar backup-footer"><button className="backup-primary-btn" disabled={busy || !ids.length || !categories.length} onClick={() => void download()}>开始导出</button><button disabled={busy} onClick={onClose}>关闭</button></div>
    </div>
  </div></div>;
}

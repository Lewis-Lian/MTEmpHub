import { ApiError, apiRequest, buildApiUrl } from './client';

export type BackupChoice = 'system' | 'backup' | 'skip';
export interface BackupOptions {
  employees: boolean;
  departments: boolean;
  shifts: boolean;
  annual_stats: boolean;
  delete_month_only: boolean;
}
export interface BackupRow {
  key: string; dataset: string; identity: string;
  status: 'new' | 'changed' | 'system_only' | 'same'; enabled: boolean;
  system: Record<string, unknown> | null; backup: Record<string, unknown> | null;
  default_choice: BackupChoice; affected_months: string[];
  fields: Array<{ name: string; label: string; system: unknown; backup: unknown; delta: number | null }>;
}
export interface BackupPreview {
  token: string; month: string; fingerprint: string; source_locked: boolean;
  summary: Record<BackupRow['status'], number>; rows: BackupRow[];
  blockers: Array<{code: string; message: string}>;
}
export interface BackupRestoreResult {
  account_set_id: number; month: string;
  counts: {new: number; updated: number; deleted: number; skipped: number}; warnings: string[];
}
export const backupDownloadUrl = (id: number) => buildApiUrl(`/api/admin/account-sets/${id}/backup`);
export function uploadBackup(file: File): Promise<BackupPreview> {
  const body = new FormData(); body.append('file', file);
  return apiRequest('/api/admin/account-set-backups/preview', {method: 'POST', body});
}
export function refreshBackupPreview(token: string, options: BackupOptions, choices: Record<string, BackupChoice> = {}): Promise<BackupPreview> {
  return apiRequest(`/api/admin/account-set-backups/${token}/preview`, {method: 'POST', body: {options, choices}});
}
export function confirmBackupRestore(token: string, body: {options: BackupOptions; choices: Record<string, BackupChoice>; fingerprint: string}): Promise<BackupRestoreResult> {
  return apiRequest(`/api/admin/account-set-backups/${token}/restore`, {method: 'POST', body});
}
export function cancelBackupPreview(token: string): Promise<unknown> {
  return apiRequest(`/api/admin/account-set-backups/${token}`, {method: 'DELETE'});
}

export interface BackupExportProgress {
  status: 'idle' | 'running' | 'ready' | 'failed' | 'completed';
  phase?: 'data' | 'packing' | 'verification' | 'download' | 'failed';
  percent: number; stage: string; completed?: number; total?: number;
}

export function downloadAccountSetBackup(id: number, month: string, onProgress: (progress: BackupExportProgress) => void): Promise<void> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const xhr = new XMLHttpRequest();
  let receiving = false;
  let settled = false;
  let polling = false;
  const poll = async () => {
    if (polling || settled || receiving) return;
    polling = true;
    try {
      const progress = await apiRequest<BackupExportProgress>(`/api/admin/account-sets/${id}/backup/progress?export_token=${token}`);
      if (!settled && !receiving && progress.status !== 'idle') onProgress(progress);
    } catch { /* Download response remains authoritative if a progress poll fails. */ }
    finally { polling = false; }
  };
  const timer = setInterval(() => void poll(), 500);
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { settled = true; clearInterval(timer); if (error) reject(error); else resolve(); };
    xhr.open('GET', `${backupDownloadUrl(id)}?export_token=${token}`);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';
    xhr.onprogress = event => {
      if (xhr.status < 200 || xhr.status >= 300) return;
      receiving = true;
      onProgress({status:'running', phase:'download', percent:event.lengthComputable && event.total ? Math.floor(event.loaded * 100 / event.total) : 0,
        completed:event.loaded, total:event.lengthComputable ? event.total : undefined,
        stage:event.lengthComputable ? `下载备份（${event.loaded.toLocaleString()} / ${event.total.toLocaleString()} 字节）` : `下载备份（已接收 ${event.loaded.toLocaleString()} 字节）`});
    };
    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = '账套导出失败';
        try { const payload = JSON.parse(await (xhr.response as Blob).text()); message = payload.error ?? message; } catch { /* Non-JSON HTTP failures keep the readable fallback. */ }
        finish(new ApiError(message, xhr.status, null)); return;
      }
      try {
        const url = URL.createObjectURL(xhr.response as Blob);
        const link = document.createElement('a'); link.href = url; link.download = `账套备份_${month}.zip`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        onProgress({status:'completed', phase:'download', percent:100, stage:'备份下载完成'});
        finish();
      } catch (error) { finish(error instanceof Error ? error : new Error('保存备份失败')); }
    };
    xhr.onerror = () => finish(new Error('网络异常，账套导出失败'));
    xhr.onabort = () => finish(new Error('账套导出已取消'));
    try { xhr.send(); } catch (error) { finish(error instanceof Error ? error : new Error('无法开始导出')); }
  });
}

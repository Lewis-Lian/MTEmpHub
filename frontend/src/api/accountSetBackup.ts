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
  return downloadBackup(backupDownloadUrl(id), `/api/admin/account-sets/${id}/backup/progress`, `账套备份_${month}.zip`, onProgress);
}

function downloadBackup(url: string, progressUrl: string, filename: string, onProgress: (progress: BackupExportProgress) => void, scope?: {account_set_ids: number[]; categories: string[]}): Promise<void> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const xhr = new XMLHttpRequest();
  let receiving = false;
  let settled = false;
  let polling = false;
  const poll = async () => {
    if (polling || settled || receiving) return;
    polling = true;
    try {
      const progress = await apiRequest<BackupExportProgress>(`${progressUrl}?export_token=${token}`);
      if (!settled && !receiving && progress.status !== 'idle') onProgress(progress);
    } catch { /* Download response remains authoritative if a progress poll fails. */ }
    finally { polling = false; }
  };
  const timer = setInterval(() => void poll(), 500);
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { settled = true; clearInterval(timer); if (error) reject(error); else resolve(); };
    xhr.open(scope ? 'POST' : 'GET', scope ? url : `${url}?export_token=${token}`);
    if (scope) xhr.setRequestHeader('Content-Type', 'application/json');
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
        const link = document.createElement('a'); link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        onProgress({status:'completed', phase:'download', percent:100, stage:'备份下载完成'});
        finish();
      } catch (error) { finish(error instanceof Error ? error : new Error('保存备份失败')); }
    };
    xhr.onerror = () => finish(new Error('网络异常，账套导出失败'));
    xhr.onabort = () => finish(new Error('账套导出已取消'));
    try { xhr.send(scope ? JSON.stringify({...scope, export_token: token}) : undefined); } catch (error) { finish(error instanceof Error ? error : new Error('无法开始导出')); }
  });
}


export interface RestoreSelection {
  months: string[]; categories: string[]; cross_month_keys: string[]; annual_keys: string[];
}
export interface MonthlyBackupRow {
  row_key: string; scope: string; dataset: string; category: string;
  month: string | null; year: string | null; status: BackupRow['status']; enabled: boolean;
  system: Record<string, unknown> | null; backup: Record<string, unknown> | null;
  default_choice: BackupChoice; choice: BackupChoice; affected_months: string[];
  password_changed?: boolean;
  reference_quality?: {system: string; backup: string};
  fields: Array<{name: string; label?: string; system: unknown; backup: unknown; delta?: number | null}>;
}
export interface MonthlyBackupPreview {
  token: string; selection: RestoreSelection; months: string[]; fingerprint: string;
  coverage: Record<string, {included: boolean; complete: boolean}>;
  rows: MonthlyBackupRow[]; summary: Record<BackupRow['status'], number>;
  blockers: Array<{code: string; message: string; row_key?: string; required_rows?: string[]}>;
}
export interface MonthlyBackupRestoreResult {
  task_id: string; months: string[]; counts: BackupRestoreResult['counts'];
  category_counts: Record<string, {new: number; updated: number; deleted: number}>;
  warnings: string[]; reauthentication_required: boolean;
}
export function uploadMonthlyBackup(file: File): Promise<MonthlyBackupPreview> {
  const body = new FormData(); body.append('file', file);
  return apiRequest('/api/admin/backups/preview', {method: 'POST', body});
}
export function refreshMonthlyBackupPreview(token: string, selection: RestoreSelection, choices: Record<string, BackupChoice>): Promise<MonthlyBackupPreview> {
  return apiRequest(`/api/admin/backups/${token}/preview`, {method: 'POST', body: {selection, choices}});
}
export function confirmMonthlyBackupRestore(token: string, body: {selection: RestoreSelection; choices: Record<string, BackupChoice>; fingerprint: string}): Promise<MonthlyBackupRestoreResult> {
  return apiRequest(`/api/admin/backups/${token}/restore`, {method: 'POST', body});
}
export function cancelMonthlyBackupPreview(token: string): Promise<unknown> {
  return apiRequest(`/api/admin/backups/${token}`, {method: 'DELETE'});
}
export function downloadMonthlyBackup(ids: number[], categories: string[], onProgress: (progress: BackupExportProgress) => void): Promise<void> {
  return downloadBackup(buildApiUrl('/api/admin/backups/export'), '/api/admin/backups/export/progress', '多月份备份.zip', onProgress, {account_set_ids: ids, categories});
}

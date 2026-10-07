import { apiRequest, buildApiUrl } from './client';

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

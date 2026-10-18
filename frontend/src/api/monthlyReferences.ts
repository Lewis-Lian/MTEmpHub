import { apiRequest } from './client';

export type ReferenceKind = 'employee' | 'department' | 'shift';
export interface ReferenceRow {
  kind: ReferenceKind; business_key: string; payload: Record<string, unknown>;
}
export interface ReferenceSnapshot extends ReferenceRow {
  month: string; quality: string; provenance: Record<string, unknown>; schema_version: number;
}
export interface ReferenceMonth {
  month: string; name: string; is_locked: boolean; snapshot_count: number; missing_count: number;
  quality_counts: Record<string, number>;
}
export interface ReferenceEvidence {
  kind: ReferenceKind; business_key: string; field: string; conflict: boolean;
  candidates: Array<{value: unknown; sources: Array<{table: string; id?: number; key?: string; field?: string; source_filename?: string}>}>;
}
export interface ReferenceDetail {
  month: string; is_locked: boolean; snapshots: ReferenceSnapshot[]; missing: ReferenceRow[];
  current: ReferenceRow[]; evidence: ReferenceEvidence[];
  archives: Array<{id: number; source_filename: string; status: string}>;
  editable_fields: Record<ReferenceKind, string[]>;
}
export type ReferenceOperation = {action: 'capture' | 'rebuild'} |
  {action: 'correct'; kind: ReferenceKind; business_key: string; changes: Record<string, unknown>; categories: string[]} |
  {action: 'reconcile'; decisions: Array<{business_key: string; field: string; value: unknown}>; categories: string[]; inspect_archives: boolean};
export interface ReferencePreview {
  month: string; action: string; fingerprint: string; required_categories: string[];
  changes: Array<{kind: ReferenceKind; business_key: string; before: ReferenceSnapshot | null; after: ReferenceSnapshot | null}>;
}
export interface ReferenceProgress {
  status: 'idle' | 'running' | 'completed' | 'failed'; phase?: string; stage: string;
  completed: number; total: number; percent: number | null;
}
export interface ReferenceProgressOptions {
  onProgress: (progress: ReferenceProgress) => void;
  signal?: AbortSignal;
}
const base = '/api/admin/monthly-references';
async function withProgress<T>(path: string, options: Parameters<typeof apiRequest>[1],
  tracking: ReferenceProgressOptions | undefined, stage: string): Promise<T> {
  if (!tracking) return apiRequest<T>(path, options);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  let settled = false, polling = false;
  const pollController = new AbortController();
  const emit = (progress: ReferenceProgress) => {if (!tracking.signal?.aborted && !settled) tracking.onProgress(progress);};
  const poll = async () => {
    if (polling || settled || tracking.signal?.aborted) return;
    polling = true;
    try {
      const progress = await apiRequest<ReferenceProgress>(`${base}/progress?progress_token=${token}`, {signal:pollController.signal});
      // The operation response confirms success, including successful commit/receipt.
      if (progress.status === 'completed') emit({...progress, status:'running', percent:null, stage:'正在接收处理结果'});
      else if (progress.status !== 'idle') emit(progress);
    } catch { /* A failed progress poll cannot change the operation result. */ }
    finally {polling = false;}
  };
  emit({status:'running', phase:'request', stage, completed:0, total:0, percent:null});
  const timer = setInterval(() => void poll(), 500);
  const stop = () => {clearInterval(timer); pollController.abort();};
  tracking.signal?.addEventListener('abort', stop, {once:true});
  try {
    const result = await apiRequest<T>(`${path}${path.includes('?') ? '&' : '?'}progress_token=${token}`, {...options, signal:tracking.signal});
    emit({status:'completed', phase:'complete', stage:`${stage.replace('正在', '')}完成`, completed:1, total:1, percent:100});
    return result;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
      emit({status:'idle', phase:'cancelled', stage:'操作已取消', completed:0, total:0, percent:null});
    } else {
      emit({status:'failed', phase:'failed', stage:error instanceof Error ? error.message : '操作失败', completed:0, total:0, percent:null});
    }
    throw error;
  } finally {
    settled = true; stop(); tracking.signal?.removeEventListener('abort', stop);
  }
}
export function listReferenceMonths(progress?: ReferenceProgressOptions): Promise<{months: ReferenceMonth[]}> {
  return withProgress(base, {}, progress, '正在读取月份列表');
}
export function fetchReferenceDetail(month: string, inspectArchives = false, progress?: ReferenceProgressOptions): Promise<ReferenceDetail> {
  return withProgress(`${base}/${month}${inspectArchives ? '?inspect_archives=1' : '?summary=1'}`, {}, progress, '正在读取当月快照');
}
export function previewReferenceOperation(month: string, operation: ReferenceOperation, progress?: ReferenceProgressOptions): Promise<ReferencePreview> {
  return withProgress(`${base}/${month}/preview`, {method:'POST', body:operation}, progress, '正在检查快照资料');
}
export function applyReferenceOperation(month: string, operation: ReferenceOperation, fingerprint: string, progress?: ReferenceProgressOptions): Promise<{month: string; changed_count: number}> {
  return withProgress(`${base}/${month}/apply`, {method:'POST', body:{...operation, fingerprint}}, progress, '正在保存快照');
}

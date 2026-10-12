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
export type ReferenceOperation = {action: 'capture'} |
  {action: 'correct'; kind: ReferenceKind; business_key: string; changes: Record<string, unknown>; categories: string[]} |
  {action: 'reconcile'; decisions: Array<{business_key: string; field: string; value: unknown}>; categories: string[]; inspect_archives: boolean};
export interface ReferencePreview {
  month: string; action: string; fingerprint: string; required_categories: string[];
  changes: Array<{kind: ReferenceKind; business_key: string; before: ReferenceSnapshot | null; after: ReferenceSnapshot}>;
}
const base = '/api/admin/monthly-references';
export function listReferenceMonths(): Promise<{months: ReferenceMonth[]}> {
  return apiRequest(base);
}
export function fetchReferenceDetail(month: string, inspectArchives = false): Promise<ReferenceDetail> {
  return apiRequest(`${base}/${month}${inspectArchives ? '?inspect_archives=1' : ''}`);
}
export function previewReferenceOperation(month: string, operation: ReferenceOperation): Promise<ReferencePreview> {
  return apiRequest(`${base}/${month}/preview`, {method: 'POST', body: operation});
}
export function applyReferenceOperation(month: string, operation: ReferenceOperation, fingerprint: string): Promise<{month: string; changed_count: number}> {
  return apiRequest(`${base}/${month}/apply`, {method: 'POST', body: {...operation, fingerprint}});
}

import { apiRequest, buildApiUrl } from "./client";

export type LedgerKind = "department" | "external" | "clearance" | "consumption";
export interface LedgerRecord {
  id: number; kind: LedgerKind; month: string; date: string; amount: number;
  name: string; emp_no: string; dept_name: string; card_no: string; remark: string;
  category: "card" | "paper"; unit: string; period: string; days: string;
  registrar: string; operator: string; voided: boolean; void_reason: string | null;
}
export interface DepartmentLedger {
  month: string; status: string;
  items: Array<{ dept_name: string; count: number; due_amount: number; paid_amount: number;
    external_card_amount: number; external_paper_amount: number; total_paid_amount: number;
    registrar: string; remark: string; historical_amount: number | null }>;
}
export interface AnnualMonth {
  month: string; employee_amount: number; external_card_amount: number; recharge_amount: number;
  paper_amount: number; floor2_amount: number | null; floor3_amount: number | null;
  consumption_amount: number | null; recovered_amount: number;
  historical_recharge_amount?: number | null; historical_recovered_amount?: number | null;
}
export interface AnnualLedger { year: number; months: AnnualMonth[]; totals: Omit<AnnualMonth, "month">; consumption_months: number }
export const fetchLedger = <T,>(kind: string, month: string) => apiRequest<T>(`/api/meal-ledgers/${kind}?month=${month}`);
export const fetchAnnual = (year: string) => apiRequest<AnnualLedger>(`/api/meal-ledgers/annual?year=${year}`);
export const saveLedger = (kind: LedgerKind, body: object) => apiRequest<LedgerRecord>(`/api/meal-ledgers/${kind}`, { method: "POST", body });
export const voidLedger = (id: number, reason: string) => apiRequest<LedgerRecord>(`/api/meal-ledgers/records/${id}/void`, { method: "POST", body: { reason } });
export const ledgerExportUrl = (report: string, month: string, year: string, extra?: Record<string, string>) =>
  buildApiUrl(`/api/meal-ledgers/export?${new URLSearchParams({ report, month, year, ...extra })}`);
export function businessMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
export const money = (value: number | null | undefined) => value == null ? "未录入" : value.toFixed(2);

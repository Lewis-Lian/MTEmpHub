import { apiRequest, buildApiUrl } from "./client";

export interface MealItem {
  id: number; emp_id: number; emp_no: string; name: string; dept_name: string; is_manager: boolean;
  days: number; base_amount: number; adjustment_amount: number; due_amount: number; paid_amount: number;
  difference: number; error: string; source: { field: string; configured_source: string; monthly_override?: number; remark?: string };
  adjustments: Array<{ id: number; amount: number; reason: string; operator: string; created_at: string }>;
  payments: Array<{ id: number; kind: string; amount: number; date: string; reference: string; operator: string; reversed: boolean }>;
}
export interface MealDepartment {
  dept_name: string; count: number; base_amount: number; adjustment_amount: number; due_amount: number;
  paid_amount: number; difference: number;
}
export interface MealBatch {
  id: number; month: string; recharge_month: string; status: "draft" | "confirmed"; version: number;
  source_changed: boolean; items: MealItem[]; departments: MealDepartment[];
}
export interface MealImportRow {
  id: number; sheet: string; row: number; kind: string; emp_no: string; name: string; dept_name: string;
  emp_id: number | null; amount: number | null; error: string; skip: boolean; correction_reason: string;
  period_conflict: string; period_confirmed: boolean;
}
export interface MealImport {
  id: number; filename: string; month: string; recharge_month: string; status: string; rows: MealImportRow[];
  person_total: number; department_total: number;
  departments: Array<{ dept_name: string; person_amount: number; historical_amount: number; difference: number }>;
}
export interface MealComparison {
  id: number; emp_no: string; name: string; historical_amount: number | null; days: number | null;
  base_amount: number | null; difference: number | null; error: string;
}
export const compareMealImport = (id: number) => apiRequest<MealComparison[]>(`/api/meal-tickets/imports/${id}/comparison`);
export const fetchMealBatch = (month: string) => apiRequest<MealBatch | null>(`/api/meal-tickets?recharge_month=${month}`);
export const mutateMealBatch = (action: string, body: object) => apiRequest<MealBatch>(`/api/meal-tickets/${action}`, { method: "POST", body });
export const mealExportUrl = (month: string) => buildApiUrl(`/api/meal-tickets/export?recharge_month=${month}`);
export const fetchMealImports = () => apiRequest<MealImport[]>("/api/meal-tickets/imports");
export const previewMealImport = (body: FormData) => apiRequest<MealImport>("/api/meal-tickets/imports", { method: "POST", body });
export const confirmMealImport = (record: MealImport) => apiRequest<MealImport>(`/api/meal-tickets/imports/${record.id}/confirm`, {
  method: "POST", body: { rows: record.rows },
});

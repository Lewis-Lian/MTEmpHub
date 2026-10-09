import { apiRequest, buildApiUrl } from "./client";

export interface MealTicketRule {
  abnormal_deduction_enabled: boolean; as_manager: boolean; abnormal_dates: string[]; deduction_cents: number;
}

export interface MealItem {
  id: number; emp_id: number; emp_no: string; name: string; dept_name: string; is_manager: boolean;
  days: number; base_amount: number; adjustment_amount: number; due_amount: number; paid_amount: number;
  difference: number; error: string; source: { field: string; configured_source: string; monthly_override?: number; remark?: string;
    meal_ticket_rule?: MealTicketRule;
    attendance_recalculation?: { days: number; base_cents: number; operator: string; created_at: string; source?: { meal_ticket_rule?: MealTicketRule } };
    supplement_confirmation?: { reason: string; operator: string; created_at: string } };
  clearances?: Array<{ date: string; amount: number; remark: string; voided: boolean }>;
  employment_status: "active" | "resigned" | "missing"; resigned_at: string | null;
  excluded: boolean; original_base_amount: number;
  participation_history: Array<{ excluded: boolean; reason: string; operator: string; created_at: string }>;
  adjustments: Array<{ id: number; amount: number; reason: string; operator: string; created_at: string }>;
  payments: Array<{ id: number; kind: string; amount: number; date: string; reference: string; operator: string; reversed: boolean; database_record?: boolean }>;
}
export interface MealDepartment {
  dept_name: string; count: number; base_amount: number; adjustment_amount: number; due_amount: number;
  paid_amount: number; difference: number;
}
export interface MealAttendanceRecalculation {
  batch_id: number; version: number; source_digest: string; total_amount: number; issues: string[];
  rows: Array<{ item_id: number; emp_no: string; name: string; previous_days: number; days: number; amount: number; excluded: boolean }>;
  new_people: Array<{ emp_id: number; emp_no: string; name: string; dept_name: string; days: number; base_amount: number; error: string }>;
}
export interface MealBatch {
  id: number; month: string; recharge_month: string; status: "draft" | "confirmed"; version: number;
  source_changed: boolean; items: MealItem[]; departments: MealDepartment[];
  database?: { enabled: boolean; configured: boolean };
  reconciliation?: {
    checked_at: string; start_date: string; end_date: string; added: number; existing: number;
    unmatched: number; zero_amount: number; outside_subsidy_month: number;
    sources: { subsidy: number; recharge: number; refund: number };
    pending_refunds?: Array<{ id: number; emp_no: string; name: string; date: string; amount: number }>;
    clearance_added?: number;
  };
}
export interface MealImportRow {
  id: number; sheet: string; row: number; kind: string; emp_no: string; name: string; dept_name: string;
  emp_id: number | null; amount: number | null; error: string; skip: boolean; correction_reason: string;
  period_conflict: string; period_confirmed: boolean;
  original_amount?: number | null; original_dept_name?: string; original_emp_id?: number | null;
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
export interface MealReadProgress {
  status: "idle" | "running" | "completed" | "failed";
  stage: string;
  completed: number;
  total: number;
}
export async function fetchMealBatch(month: string, onProgress?: (progress: MealReadProgress) => void, signal?: AbortSignal): Promise<MealBatch | null> {
  const path = `/api/meal-tickets?recharge_month=${month}`;
  if (!onProgress) return apiRequest<MealBatch | null>(path);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const progress = await apiRequest<MealReadProgress>(`/api/meal-tickets/progress?token=${token}`, { signal });
      if (!finished && !signal?.aborted && progress.status !== "idle") onProgress(progress);
    } catch { /* The data response remains authoritative if a progress request fails. */ }
    if (!finished && !signal?.aborted) timer = setTimeout(() => void poll(), 400);
  };
  timer = setTimeout(() => void poll(), 400);
  try {
    return await apiRequest<MealBatch | null>(path, { headers: { "X-Meal-Progress-Token": token }, signal });
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}
export const mutateMealBatch = (action: string, body: object) => apiRequest<MealBatch>(`/api/meal-tickets/${action}`, { method: "POST", body });
export const mealRechargeExportUrl = (month: string) => buildApiUrl(`/api/meal-tickets/export-recharge?recharge_month=${month}`);
export const fetchMealImports = () => apiRequest<MealImport[]>("/api/meal-tickets/imports");
export const previewMealImport = (body: FormData) => apiRequest<MealImport>("/api/meal-tickets/imports", { method: "POST", body });
export const cancelMealImport = (id: number) => apiRequest<{ deleted: number }>(`/api/meal-tickets/imports/${id}`, { method: "DELETE" });
export const confirmMealImport = (record: MealImport) => apiRequest<MealImport>(`/api/meal-tickets/imports/${record.id}/confirm`, {
  method: "POST", body: { rows: record.rows },
});

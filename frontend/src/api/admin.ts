import { apiRequest } from "./client";
import { ApiError, apiUploadRequest } from "./client";
import type {
  AdminAccountSet,
  AdminAccountSetFactoryRestEntry,
  AdminAccountSetImport,
  AdminBootstrap,
  AdminDepartment,
  AdminDisabledUser,
  AdminEmployee,
  AdminShift,
} from "../types/admin";
import type { AttendanceCalendarData } from "../types/query";

let adminBootstrapPromise: Promise<AdminBootstrap> | null = null;

function expectArrayResponse<T>(payload: unknown, label: string): T[] {
  if (!Array.isArray(payload)) {
    throw new ApiError(`${label}返回格式不正确`, 500, payload);
  }
  return payload;
}

export function fetchAdminBootstrap(): Promise<AdminBootstrap> {
  if (!adminBootstrapPromise) {
    adminBootstrapPromise = apiRequest<AdminBootstrap>("/api/admin/bootstrap");
  }
  return adminBootstrapPromise;
}

export function fetchAdminRows<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export type EmployeeStatusFilter = "active" | "resigned" | "all";

export async function fetchAdminEmployees(status?: EmployeeStatusFilter): Promise<AdminEmployee[]> {
  const path = status ? `/api/admin/employees?status=${status}` : "/api/admin/employees";
  return expectArrayResponse<AdminEmployee>(await apiRequest<unknown>(path), "员工列表");
}

export async function fetchAdminDepartments(): Promise<AdminDepartment[]> {
  return expectArrayResponse<AdminDepartment>(await apiRequest<unknown>("/api/admin/departments"), "部门列表");
}

export async function fetchAdminShifts(): Promise<AdminShift[]> {
  return expectArrayResponse<AdminShift>(await apiRequest<unknown>("/api/admin/shifts"), "班次列表");
}

export async function fetchDisabledUsers(): Promise<AdminDisabledUser[]> {
  return expectArrayResponse<AdminDisabledUser>(await apiRequest<unknown>("/api/admin/disabled-users"), "禁用用户列表");
}

export function unlockDisabledUser(userId: number): Promise<{ status: string; user: AdminDisabledUser }> {
  return apiRequest<{ status: string; user: AdminDisabledUser }>(`/api/admin/disabled-users/${userId}/unlock`, {
    method: "POST",
  });
}

export function createAdminEmployee(payload: Record<string, unknown>): Promise<{ status: string; employee: AdminEmployee }> {
  return apiRequest<{ status: string; employee: AdminEmployee }>("/api/admin/employees", {
    body: payload,
    method: "POST",
  });
}

export function updateAdminEmployee(
  employeeId: number,
  payload: Record<string, unknown>,
): Promise<{ status: string; employee: AdminEmployee }> {
  return apiRequest<{ status: string; employee: AdminEmployee }>(`/api/admin/employees/${employeeId}`, {
    body: payload,
    method: "PUT",
  });
}

export function deleteAdminEmployee(employeeId: number): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/employees/${employeeId}`, {
    method: "DELETE",
  });
}

export function batchAdminEmployees(payload: Record<string, unknown>): Promise<{ status: string; affected: number }> {
  return apiRequest<{ status: string; affected: number }>("/api/admin/employees/batch", {
    body: payload,
    method: "POST",
  });
}

export function resignAdminEmployee(payload: { emp_no: string; resigned_at: string }): Promise<{ status: string; employee: AdminEmployee }> {
  return apiRequest<{ status: string; employee: AdminEmployee }>("/api/admin/employees/resign", {
    body: payload,
    method: "POST",
  });
}

export function reinstateAdminEmployee(employeeId: number): Promise<{ status: string; employee: AdminEmployee }> {
  return apiRequest<{ status: string; employee: AdminEmployee }>(`/api/admin/employees/${employeeId}/reinstate`, {
    method: "POST",
  });
}

export function importAdminEmployees(file: File): Promise<{ status: string; imported: number }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<{ status: string; imported: number }>("/api/admin/employees/import", {
    body: formData,
    method: "POST",
  });
}

export function createAdminDepartment(payload: Record<string, unknown>): Promise<{ status: string; id: number }> {
  return apiRequest<{ status: string; id: number }>("/api/admin/departments", {
    body: payload,
    method: "POST",
  });
}

export function updateAdminDepartment(departmentId: number, payload: Record<string, unknown>): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/departments/${departmentId}`, {
    body: payload,
    method: "PUT",
  });
}

export function deleteAdminDepartment(departmentId: number): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/departments/${departmentId}`, {
    method: "DELETE",
  });
}

export function batchAdminDepartments(payload: Record<string, unknown>): Promise<{ status: string; affected: number }> {
  return apiRequest<{ status: string; affected: number }>("/api/admin/departments/batch", {
    body: payload,
    method: "POST",
  });
}

export function importAdminDepartments(file: File): Promise<{ status: string; imported: number }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<{ status: string; imported: number }>("/api/admin/departments/import", {
    body: formData,
    method: "POST",
  });
}

export function deleteUnboundAdminDepartments(): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>("/api/admin/departments/delete-unbound", {
    method: "POST",
  });
}

export function createAdminShift(payload: Record<string, unknown>): Promise<{ status: string; id: number }> {
  return apiRequest<{ status: string; id: number }>("/api/admin/shifts", {
    body: payload,
    method: "POST",
  });
}

export function updateAdminShift(shiftId: number, payload: Record<string, unknown>): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/shifts/${shiftId}`, {
    body: payload,
    method: "PUT",
  });
}

export function deleteAdminShift(shiftId: number): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/shifts/${shiftId}`, {
    method: "DELETE",
  });
}

export async function fetchAccountSets(): Promise<AdminAccountSet[]> {
  return expectArrayResponse<AdminAccountSet>(await apiRequest<unknown>("/api/admin/account-sets"), "账套列表");
}

export function createAccountSet(month: string): Promise<{ status: string; account_set: AdminAccountSet }> {
  return apiRequest<{ status: string; account_set: AdminAccountSet }>("/api/admin/account-sets", {
    body: { month },
    method: "POST",
  });
}

export function updateAccountSet(
  accountSetId: number,
  payload: { monthly_benefit_days: number | string; factory_rest_entries?: AdminAccountSetFactoryRestEntry[] },
): Promise<{ status: string; account_set: AdminAccountSet }> {
  return apiRequest<{ status: string; account_set: AdminAccountSet }>(`/api/admin/account-sets/${accountSetId}`, {
    body: payload,
    method: "PUT",
  });
}

export function activateAccountSet(accountSetId: number): Promise<{ status: string; account_set: AdminAccountSet }> {
  return apiRequest<{ status: string; account_set: AdminAccountSet }>(
    `/api/admin/account-sets/${accountSetId}/activate`,
    {
      method: "POST",
    },
  );
}

export function lockAccountSet(accountSetId: number): Promise<{ status: string; account_set: AdminAccountSet }> {
  return apiRequest<{ status: string; account_set: AdminAccountSet }>(`/api/admin/account-sets/${accountSetId}/lock`, {
    method: "POST",
  });
}

export function unlockAccountSet(accountSetId: number): Promise<{ status: string; account_set: AdminAccountSet }> {
  return apiRequest<{ status: string; account_set: AdminAccountSet }>(
    `/api/admin/account-sets/${accountSetId}/unlock`,
    {
      method: "POST",
    },
  );
}

export function deleteAccountSet(accountSetId: number): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/admin/account-sets/${accountSetId}`, {
    method: "DELETE",
  });
}

export async function fetchAccountSetImports(accountSetId: number): Promise<AdminAccountSetImport[]> {
  return expectArrayResponse<AdminAccountSetImport>(
    await apiRequest<unknown>(`/api/admin/account-sets/${accountSetId}/imports`),
    "账套导入记录",
  );
}

export interface AccountSetRawFileUploadResult {
  file: string;
  status: "ok" | "error";
  message?: string;
  error?: string;
}

export function uploadAccountSetRawFiles(
  accountSetId: number,
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<{ status: string; success?: number; failed?: number; results?: AccountSetRawFileUploadResult[] }> {
  const formData = new FormData();
  formData.append("account_set_id", String(accountSetId));
  files.forEach((file) => formData.append("files", file));
  return apiUploadRequest<{ status: string; success?: number; failed?: number; results?: AccountSetRawFileUploadResult[] }>(
    "/api/admin/import/raw-files",
    {
      body: formData,
      onProgress,
    },
  );
}

export function resetAccountSetImported(
  accountSetId: number,
): Promise<{ status: string; month?: string; deleted?: Record<string, number> }> {
  return apiRequest<{ status: string; month?: string; deleted?: Record<string, number> }>(
    `/api/admin/account-sets/${accountSetId}/reset-imported`,
    {
      method: "POST",
    },
  );
}

export function calculateAccountSet(
  accountSetId: number,
  mode: "employee" | "manager",
): Promise<{ status: string; message?: string }> {
  return apiRequest<{ status: string; message?: string }>(
    `/api/admin/account-sets/${accountSetId}/calculate?mode=${encodeURIComponent(mode)}`,
    {
      method: "POST",
    },
  );
}

export interface AccountSetCalculationProgress {
  status: "idle" | "running" | "finished";
  percent: number;
  stage: string;
}

export function fetchAccountSetCalculationProgress(
  accountSetId: number,
  mode: "employee" | "manager",
): Promise<AccountSetCalculationProgress> {
  return apiRequest<AccountSetCalculationProgress>(
    `/api/admin/account-sets/${accountSetId}/calculate/progress?mode=${encodeURIComponent(mode)}`,
  );
}

// ---- 数据库设置 ----

export interface DatabaseSettings {
  current: Array<{ item: string; value: string; description: string }>;
  mysql_config: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
  };
}

export function getDatabaseSettings(setupPassword?: string): Promise<DatabaseSettings> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<DatabaseSettings>("/api/admin/database-settings", { headers });
}

export function saveDatabaseSettings(settings: Omit<DatabaseSettings["mysql_config"], "password"> & { password?: string }, setupPassword?: string): Promise<{ message: string }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ message: string }>("/api/admin/database-settings", {
    method: "PUT",
    body: settings,
    headers,
  });
}

export function testDatabaseConnection(settings: Omit<DatabaseSettings["mysql_config"], "password"> & { password?: string }, setupPassword?: string): Promise<{ ok: boolean; message: string }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ ok: boolean; message: string }>("/api/admin/database-test-connection", {
    method: "POST",
    body: settings,
    headers,
  });
}

export function migrateDatabase(setupPassword?: string): Promise<{ ok: boolean; message?: string; results?: any }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ ok: boolean; message?: string; results?: any }>("/api/admin/database-migrate", { method: "POST", headers });
}

export function migrateToSqliteDatabase(setupPassword?: string): Promise<{ ok: boolean; message?: string; results?: any }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ ok: boolean; message?: string; results?: any }>("/api/admin/database-migrate-to-sqlite", { method: "POST", headers });
}

export function switchToSqlite(setupPassword?: string): Promise<{ message: string }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ message: string }>("/api/admin/database-switch-sqlite", { method: "POST", headers });
}

export function switchToMysql(setupPassword?: string): Promise<{ message: string }> {
  const headers = setupPassword ? { "X-Setup-Password": setupPassword } : undefined;
  return apiRequest<{ message: string }>("/api/admin/database-switch-mysql", { method: "POST", headers });
}

export interface DailyOverrideSavePayload {
  month: string;
  emp_id: number;
  date: string;
  status?: string;
  is_evening_overtime?: boolean;
  work_hours?: string | number;
  late_minutes?: string | number;
  early_leave_minutes?: string | number;
  remark?: string;
}

export interface DailyOverrideRecordResponse<TRow> {
  calendar: AttendanceCalendarData;
  row: TRow;
}

export function fetchAdminDailyOverrideCalendar(
  empId: number,
  month: string,
): Promise<AttendanceCalendarData> {
  const query = new URLSearchParams({ emp_id: String(empId), month });
  return apiRequest<AttendanceCalendarData>(
    `/api/admin/attendance-override-daily/calendar?${query.toString()}`,
  );
}

export function saveAdminDailyOverride<TRow>(
  payload: DailyOverrideSavePayload,
): Promise<DailyOverrideRecordResponse<TRow>> {
  return apiRequest<DailyOverrideRecordResponse<TRow>>("/api/admin/attendance-override-daily/record", {
    body: payload,
    method: "PUT",
  });
}

export function clearAdminDailyOverride<TRow>(empId: number, date: string): Promise<DailyOverrideRecordResponse<TRow>> {
  const query = new URLSearchParams({ emp_id: String(empId), date });
  return apiRequest<DailyOverrideRecordResponse<TRow>>(
    `/api/admin/attendance-override-daily/record?${query.toString()}`,
    { method: "DELETE" },
  );
}

export interface LateOffsetLeaveRow {
  leave_no: string;
  leave_type: string;
  start_time: string;
  end_time: string;
  duration: number;
  approval_status: string;
  reason: string;
}

export interface LateOffsetLeavesResponse {
  month: string;
  emp_id: number;
  emp_name: string;
  rows: LateOffsetLeaveRow[];
}

export function fetchAdminLateOffsetLeaves(
  empId: number,
  month: string,
): Promise<LateOffsetLeavesResponse> {
  const query = new URLSearchParams({ emp_id: String(empId), month });
  return apiRequest<LateOffsetLeavesResponse>(
    `/api/admin/late-offset/leaves?${query.toString()}`,
  );
}

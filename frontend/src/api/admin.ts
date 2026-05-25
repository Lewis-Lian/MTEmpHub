import { apiRequest } from "./client";
import { ApiError } from "./client";
import type { AdminAccountSet, AdminAccountSetFactoryRestEntry, AdminAccountSetImport, AdminBootstrap } from "../types/admin";

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

export function uploadAccountSetRawFiles(accountSetId: number, files: File[]): Promise<{ status: string; message?: string }> {
  const formData = new FormData();
  formData.append("account_set_id", String(accountSetId));
  files.forEach((file) => formData.append("files", file));
  return apiRequest<{ status: string; message?: string }>("/api/admin/import/raw-files", {
    body: formData,
    method: "POST",
  });
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

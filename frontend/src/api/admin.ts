import { apiRequest } from "./client";
import type { AdminBootstrap } from "../types/admin";

let adminBootstrapPromise: Promise<AdminBootstrap> | null = null;

export function fetchAdminBootstrap(): Promise<AdminBootstrap> {
  if (!adminBootstrapPromise) {
    adminBootstrapPromise = apiRequest<AdminBootstrap>("/api/admin/bootstrap");
  }
  return adminBootstrapPromise;
}

export function fetchAdminRows<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

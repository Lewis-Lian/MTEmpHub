import { apiRequest, buildApiUrl } from "./client";
import type {
  AttendanceCalendarData,
  HeaderRowsResponse,
  HomeSummaryResponse,
  QueryBootstrap,
  QueryNavigationModule,
} from "../types/query";

let queryBootstrapPromise: Promise<QueryBootstrap> | null = null;

export function fetchNavigation(): Promise<{ modules: QueryNavigationModule[] }> {
  return apiRequest<{ modules: QueryNavigationModule[] }>("/api/query/navigation");
}

export function fetchQueryBootstrap(): Promise<QueryBootstrap> {
  if (!queryBootstrapPromise) {
    queryBootstrapPromise = apiRequest<QueryBootstrap>("/api/query/bootstrap");
  }
  return queryBootstrapPromise;
}

export function clearQueryBootstrapCache() {
  queryBootstrapPromise = null;
}


export function fetchHomeSummary(month?: string): Promise<HomeSummaryResponse> {
  const query = new URLSearchParams();
  if (month) {
    query.set("month", month);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<HomeSummaryResponse>(`/api/query/home-summary${suffix}`);
}

export function fetchHeaderRows(path: string, query: URLSearchParams): Promise<HeaderRowsResponse> {
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<HeaderRowsResponse>(`${path}${suffix}`);
}

export function fetchObjectRows<T>(path: string, query: URLSearchParams): Promise<T[]> {
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<T[]>(`${path}${suffix}`);
}

export function buildDownloadUrl(path: string, query: URLSearchParams): string {
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return buildApiUrl(`${path}${suffix}`);
}

export function fetchAttendanceCalendar(empId: number, month: string): Promise<AttendanceCalendarData> {
  const query = new URLSearchParams({ emp_id: String(empId), month });
  return apiRequest<AttendanceCalendarData>(`/api/query/attendance-calendar?${query.toString()}`);
}

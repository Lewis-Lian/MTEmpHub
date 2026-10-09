import { apiRequest, buildApiUrl } from "./client";
import type {
  AttendanceCalendarData,
  HeaderRowsResponse,
  HomeSummaryResponse,
  QueryBootstrap,
  QueryNavigationModule,
} from "../types/query";

const queryBootstrapPromises = new Map<string, Promise<QueryBootstrap>>();

export function fetchNavigation(): Promise<{ modules: QueryNavigationModule[] }> {
  return apiRequest<{ modules: QueryNavigationModule[] }>("/api/query/navigation");
}

export function fetchQueryBootstrap(month?: string): Promise<QueryBootstrap> {
  const key = month ?? "";
  let promise = queryBootstrapPromises.get(key);
  if (!promise) {
    const query = new URLSearchParams();
    if (month) query.set("month", month);
    promise = apiRequest<QueryBootstrap>(withQuery("/api/query/bootstrap", query)).catch((error) => {
      queryBootstrapPromises.delete(key);
      throw error;
    });
    queryBootstrapPromises.set(key, promise);
  }
  return promise;
}

export function clearQueryBootstrapCache() {
  queryBootstrapPromises.clear();
}

function withQuery(path: string, query: URLSearchParams): string {
  const params = query.toString();
  return params ? `${path}?${params}` : path;
}

export function fetchHomeSummary(month?: string): Promise<HomeSummaryResponse> {
  const query = new URLSearchParams();
  if (month) {
    query.set("month", month);
  }
  return apiRequest<HomeSummaryResponse>(withQuery("/api/query/home-summary", query));
}

export function fetchHeaderRows(path: string, query: URLSearchParams): Promise<HeaderRowsResponse> {
  return apiRequest<HeaderRowsResponse>(withQuery(path, query));
}

export function fetchObjectRows<T>(path: string, query: URLSearchParams): Promise<T[]> {
  return apiRequest<T[]>(withQuery(path, query));
}

export function buildDownloadUrl(path: string, query: URLSearchParams): string {
  return buildApiUrl(withQuery(path, query));
}

export function fetchAttendanceCalendar(empId: number, month: string): Promise<AttendanceCalendarData> {
  const query = new URLSearchParams({ emp_id: String(empId), month });
  return apiRequest<AttendanceCalendarData>(`/api/query/attendance-calendar?${query.toString()}`);
}

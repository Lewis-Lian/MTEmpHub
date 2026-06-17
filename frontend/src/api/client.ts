export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type JsonBody = object;
type RequestBody = FormData | JsonBody | string | null;
type RequestOptions = Omit<RequestInit, "body"> & {
  body?: RequestBody;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: FormData | string | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (typeof options.body === "string") {
    body = options.body;
  } else if (options.body && typeof options.body === "object") {
    body = JSON.stringify(options.body);
  }

  if (body && typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    body,
    headers,
    credentials: "include",
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = (extractErrorMessage(payload) ?? response.statusText) || "请求失败";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

// 从后端响应中提取可展示的错误信息：
// - JSON 形如 { error: "..." } 或 { error: { message: "..." } } → 取对应文本
// - error 为字符串则直接使用；为对象则降级 JSON.stringify，避免得到 "[object Object]"
function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const inner = (error as { message?: unknown }).message;
    if (typeof inner === "string") {
      return inner;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return undefined;
  }
}

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

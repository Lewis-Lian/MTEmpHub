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

type JsonBody = Record<string, unknown>;
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
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : response.statusText || "请求失败";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

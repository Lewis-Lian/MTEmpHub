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

// fetch 无法获取上传进度，带进度的请求（如文件上传）走 XMLHttpRequest
export function apiUploadRequest<T>(
  path: string,
  options: { body: FormData; onProgress?: (percent: number) => void },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader("Content-Type") ?? "";
      let payload: unknown;
      try {
        payload = contentType.includes("application/json") ? JSON.parse(xhr.responseText) : xhr.responseText;
      } catch {
        // onload 是事件回调，抛出的异常不会 reject Promise，必须在这里显式失败
        reject(new Error("服务器响应解析失败"));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const message = (extractErrorMessage(payload) ?? xhr.statusText) || "请求失败";
        reject(new ApiError(message, xhr.status, payload));
        return;
      }

      resolve(payload as T);
    };
    xhr.onerror = () => reject(new Error("网络错误，请求失败"));

    xhr.send(options.body);
  });
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

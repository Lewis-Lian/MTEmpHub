import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiUploadRequest, ApiError } from "./client";

// 测试专用 FakeXHR：只镜像 apiUploadRequest 依赖的 XMLHttpRequest 上传相关接口，
// 代替真实网络层；进度/完成事件由测试手动触发。
interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXMLHttpRequest {
  static last: FakeXMLHttpRequest | null = null;

  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  withCredentials = false;
  status = 200;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((event: ProgressEventLike) => void) | null } = { onprogress: null };

  constructor() {
    FakeXMLHttpRequest.last = this;
  }

  getResponseHeader = vi.fn(() => "application/json");

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }

  emitLoad() {
    this.onload?.();
  }

  emitError() {
    this.onerror?.();
  }
}

describe("apiUploadRequest", () => {
  beforeEach(() => {
    FakeXMLHttpRequest.last = null;
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("上传过程中按已传输字节回调进度百分比", async () => {
    const onProgress = vi.fn();
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", {
      body: new FormData(),
      onProgress,
    });

    const xhr = FakeXMLHttpRequest.last!;
    xhr.emitProgress(50, 200);
    xhr.emitProgress(120, 200);
    xhr.emitProgress(200, 200);
    xhr.responseText = '{"status":"ok"}';
    xhr.emitLoad();

    await expect(promise).resolves.toEqual({ status: "ok" });
    expect(onProgress.mock.calls.map(([percent]) => percent)).toEqual([25, 60, 100]);
  });

  it("以 POST 与会话凭证向目标接口发送表单", async () => {
    const body = new FormData();
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", { body });

    const xhr = FakeXMLHttpRequest.last!;
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/admin/import/raw-files");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.send).toHaveBeenCalledWith(body);

    xhr.responseText = '{"status":"ok"}';
    xhr.emitLoad();
    await promise;
  });

  it("服务器返回错误状态时抛出带后端消息的 ApiError", async () => {
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", {
      body: new FormData(),
    });

    const xhr = FakeXMLHttpRequest.last!;
    xhr.status = 400;
    xhr.responseText = '{"error":"账套已锁定"}';
    xhr.emitLoad();

    const error = (await promise.catch((caught) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("账套已锁定");
    expect(error.status).toBe(400);
  });

  it("进度不可计算时不回调进度", async () => {
    const onProgress = vi.fn();
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", {
      body: new FormData(),
      onProgress,
    });

    const xhr = FakeXMLHttpRequest.last!;
    xhr.emitProgress(50, 0, false);
    xhr.responseText = '{"status":"ok"}';
    xhr.emitLoad();

    await promise;
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("响应声明为 JSON 但内容非法时请求失败而非挂起", async () => {
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", {
      body: new FormData(),
    });

    const xhr = FakeXMLHttpRequest.last!;
    xhr.responseText = "not-json";
    xhr.emitLoad();

    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it("非 JSON 响应按原始文本返回", async () => {
    const promise = apiUploadRequest<string>("/api/admin/import/raw-files", {
      body: new FormData(),
    });

    const xhr = FakeXMLHttpRequest.last!;
    xhr.getResponseHeader = vi.fn(() => "text/plain");
    xhr.responseText = "ok";
    xhr.emitLoad();

    await expect(promise).resolves.toBe("ok");
  });

  it("网络错误时请求失败", async () => {
    const promise = apiUploadRequest<{ status: string }>("/api/admin/import/raw-files", {
      body: new FormData(),
    });

    FakeXMLHttpRequest.last!.emitError();

    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});

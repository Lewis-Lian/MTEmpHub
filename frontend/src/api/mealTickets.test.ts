import { afterEach, expect, it, vi } from "vitest";
import { fetchMealBatch } from "./mealTickets";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("月度读取忽略暂时失败的进度请求，完成后停止轮询", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  let polls = 0;
  const fetchMock = vi.fn((url: string) => {
    if (!url.includes("/progress?")) return new Promise<Response>(resolve => { finish = resolve; });
    polls += 1;
    if (polls === 1) return Promise.reject(new Error("暂时断网"));
    return Promise.resolve(new Response(JSON.stringify({ status: "running", stage: "计算员工考勤", completed: 2, total: 5 }), { headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const progress: number[] = [];
  const result = fetchMealBatch("2026-09", event => progress.push(event.completed / event.total));
  await vi.advanceTimersByTimeAsync(800);
  expect(progress).toEqual([0.4]);
  finish(new Response("null", { headers: { "Content-Type": "application/json" } }));
  expect(await result).toBeNull();
  await vi.advanceTimersByTimeAsync(1200);
  expect(polls).toBe(2);
});

it("账目读取结束后不会接收滞后的进度响应", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  let finishProgress!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>(resolve => {
    if (url.includes("/progress?")) finishProgress = resolve; else finish = resolve;
  })));
  const progress: string[] = [];
  const result = fetchMealBatch("2026-09", event => progress.push(event.stage));
  await vi.advanceTimersByTimeAsync(400);
  finish(new Response("null", { headers: { "Content-Type": "application/json" } }));
  await result;
  finishProgress(new Response(JSON.stringify({ status: "running", stage: "旧进度", completed: 1, total: 2 }), { headers: { "Content-Type": "application/json" } }));
  await vi.advanceTimersByTimeAsync(800);
  expect(progress).toEqual([]);
});

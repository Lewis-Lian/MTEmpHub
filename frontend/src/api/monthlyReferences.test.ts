import {afterEach, expect, it, vi} from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({apiRequest: request}));
import {listReferenceMonths} from './monthlyReferences';
afterEach(() => {vi.useRealTimers(); vi.resetAllMocks();});

it('reports actual server counts and finishes only after the request succeeds', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  request.mockImplementation((path: string) => path.includes('/progress?')
    ? Promise.resolve({status:'running', phase:'read', stage:'读取员工资料', completed:3, total:8, percent:37.5})
    : new Promise(resolve => {finish = resolve;}));
  const progress = vi.fn();
  const pending = listReferenceMonths({onProgress:progress});
  await vi.advanceTimersByTimeAsync(500);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({completed:3, total:8, percent:37.5}));
  expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({status:'completed'}));
  finish({months:[]});
  await pending;
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({status:'completed', percent:100}));
  const calls = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1500);
  expect(request).toHaveBeenCalledTimes(calls);
});

it('does not let a polling failure or premature completion override the request outcome', async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  request.mockImplementation((path: string) => path.includes('/progress?')
    ? Promise.resolve({status:'completed', stage:'服务器已处理', percent:100, total:2, completed:2})
    : new Promise((_, reject) => {fail = reject;}));
  const progress = vi.fn();
  const pending = listReferenceMonths({onProgress:progress});
  const outcome = expect(pending).rejects.toThrow('连接中断');
  await vi.advanceTimersByTimeAsync(500);
  expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({status:'completed'}));
  fail(new Error('连接中断'));
  await outcome;
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({status:'failed'}));
});

it('stops polling and callbacks when the page aborts a request', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  request.mockImplementation((_path: string, options: {signal?:AbortSignal}) => new Promise((_, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const progress = vi.fn();
  const pending = listReferenceMonths({onProgress:progress, signal:controller.signal});
  const outcome = expect(pending).rejects.toThrow('Aborted');
  controller.abort();
  await outcome;
  const calls = progress.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1500);
  expect(progress).toHaveBeenCalledTimes(calls);
  expect(request).toHaveBeenCalledTimes(1);
});

it('continues to return the operation result when progress polling is unavailable', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  request.mockImplementation((path: string) => path.includes('/progress?')
    ? Promise.reject(new Error('poll unavailable')) : new Promise(resolve => {finish = resolve;}));
  const progress = vi.fn();
  const pending = listReferenceMonths({onProgress:progress});
  await vi.advanceTimersByTimeAsync(500);
  expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({status:'failed'}));
  finish({months:[]});
  await expect(pending).resolves.toEqual({months:[]});
});

it('reports cancellation without exposing the browser abort message as a failure', async () => {
  request.mockRejectedValue(new DOMException('signal is aborted without reason', 'AbortError'));
  const progress = vi.fn();
  await expect(listReferenceMonths({onProgress:progress})).rejects.toHaveProperty('name','AbortError');
  expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({status:'failed'}));
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({status:'idle', stage:'操作已取消'}));
});

import { afterEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('./client', async importOriginal => ({...(await importOriginal<object>()), apiRequest: request}));
import { downloadAccountSetBackup } from './accountSetBackup';

class DownloadXHR {
  static instance: DownloadXHR;
  status = 200; response = new Blob(['zip'], {type:'application/zip'});
  responseType = ''; withCredentials = false;
  onprogress?: (event: {lengthComputable: boolean; loaded: number; total: number}) => void;
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  open = vi.fn(); send = vi.fn(); getResponseHeader = vi.fn(() => 'application/zip');
  constructor() { DownloadXHR.instance = this; }
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});
it('reports backend work and actual transferred bytes then saves the selected month', async () => {
  vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', DownloadXHR);
  vi.stubGlobal('URL', {createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn()});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  request.mockResolvedValue({status:'running', phase:'packing', percent:40, completed:4, total:10, stage:'打包原始文件'});
  const progress = vi.fn();
  const task = downloadAccountSetBackup(7, '2026-06', progress);
  await vi.advanceTimersByTimeAsync(600);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({phase:'packing', percent:40}));
  const xhr = DownloadXHR.instance;
  xhr.onprogress?.({lengthComputable:true, loaded:5, total:10});
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({phase:'download', percent:50, completed:5,total:10}));
  xhr.onload?.(); await task;
  expect(click).toHaveBeenCalled();
  expect(xhr.open).toHaveBeenCalledWith('GET', expect.stringContaining('/account-sets/7/backup?export_token='));
  expect(vi.getTimerCount()).toBe(1); // Object URL cleanup only, polling stopped.
});
it('surfaces server errors without reporting successful completion', async () => {
  vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', DownloadXHR);
  request.mockResolvedValue({status:'idle',percent:0,stage:'等待'});
  const progress = vi.fn();
  const task = downloadAccountSetBackup(7, '2026-06', progress);
  const failure = expect(task).rejects.toThrow('文件缺失');
  DownloadXHR.instance.status = 400;
  DownloadXHR.instance.response = new Blob(['{"error":"文件缺失"}'], {type:'application/json'});
  DownloadXHR.instance.onload?.();
  await failure;
  expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({status:'completed'}));
  expect(vi.getTimerCount()).toBe(0);
});

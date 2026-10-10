import { afterEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('./client', async importOriginal => ({...(await importOriginal<object>()), apiRequest: request}));
import { downloadAccountSetBackup, uploadMonthlyBackup } from './accountSetBackup';

class DownloadXHR {
  static instance: DownloadXHR;
  status = 200; response = new Blob(['zip'], {type:'application/zip'});
  responseType = ''; withCredentials = false;
  responseText = '{"token":"preview"}';
  upload: {onprogress?: (event: {lengthComputable: boolean; loaded: number; total: number}) => void; onload?: () => void} = {};
  onprogress?: (event: {lengthComputable: boolean; loaded: number; total: number}) => void;
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  open = vi.fn(); send = vi.fn(); setRequestHeader = vi.fn(); getResponseHeader = vi.fn(() => 'application/zip');
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
it('reports real upload bytes then backend counts and stops polling when the response arrives', async () => {
  vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', DownloadXHR);
  request.mockResolvedValue({status:'running', phase:'target', percent:25, completed:25, total:100, stage:'读取本地数据'});
  const progress = vi.fn();
  const task = uploadMonthlyBackup(new File(['zip'],'backup.zip'), progress);
  const xhr = DownloadXHR.instance;
  xhr.upload.onprogress?.({lengthComputable:true,loaded:5,total:10});
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({phase:'upload',completed:5,total:10,percent:50}));
  xhr.upload.onload?.();
  await vi.advanceTimersByTimeAsync(600);
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({phase:'target',completed:25,total:100,percent:25}));
  xhr.getResponseHeader.mockReturnValue('application/json'); xhr.onload?.();
  await expect(task).resolves.toEqual({token:'preview'});
  expect(vi.getTimerCount()).toBe(0);
});
it('stops import polling and propagates validation errors', async () => {
  vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', DownloadXHR);
  const task = uploadMonthlyBackup(new File(['bad'],'backup.zip'), vi.fn());
  const failure = expect(task).rejects.toThrow('单据时间区间无效');
  const xhr = DownloadXHR.instance;
  xhr.status = 400; xhr.responseText = '{"error":"单据时间区间无效"}';
  xhr.getResponseHeader.mockReturnValue('application/json'); xhr.onload?.();
  await failure;
  expect(vi.getTimerCount()).toBe(0);
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

it('posts multi-month export scope and polls its task-bound progress', async () => {
  const { downloadMonthlyBackup } = await import('./accountSetBackup');
  vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', DownloadXHR);
  vi.stubGlobal('URL', {createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn()});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  request.mockResolvedValue({status:'running', phase:'data', percent:20, stage:'收集数据'});
  const task = downloadMonthlyBackup([1, 2], ['attendance', 'accounts'], vi.fn());
  expect(DownloadXHR.instance.open).toHaveBeenCalledWith('POST', expect.stringContaining('/api/admin/backups/export'));
  expect(JSON.parse(DownloadXHR.instance.send.mock.calls[0][0])).toEqual({account_set_ids:[1,2],categories:['attendance','accounts'],export_token: expect.any(String)});
  await vi.advanceTimersByTimeAsync(600);
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/admin/backups/export/progress?export_token='));
  DownloadXHR.instance.onload?.(); await task;
});
it('uses the multi-month endpoints and sends only selection, choices and fingerprint', async () => {
  const api = await import('./accountSetBackup');
  const file = new File(['zip'], 'backup.zip');
  const selection = {months:['2026-06'],categories:['attendance'],cross_month_keys:[],annual_keys:[]};
  await api.uploadMonthlyBackup(file);
  const [path, options] = request.mock.calls[request.mock.calls.length - 1];
  expect(path).toBe('/api/admin/backups/preview'); expect(options.body.get('file')).toBe(file);
  await api.refreshMonthlyBackupPreview('task', selection, {'month/2026-06/daily_records/["E1"]':'backup'});
  expect(request).toHaveBeenLastCalledWith('/api/admin/backups/task/preview', {method:'POST',body:{selection,choices:{'month/2026-06/daily_records/["E1"]':'backup'}}});
  await api.confirmMonthlyBackupRestore('task', {selection, choices:{}, fingerprint:'fp'});
  expect(request).toHaveBeenLastCalledWith('/api/admin/backups/task/restore', {method:'POST',body:{selection,choices:{},fingerprint:'fp'}});
  await api.cancelMonthlyBackupPreview('task');
  expect(request).toHaveBeenLastCalledWith('/api/admin/backups/task', {method:'DELETE'});
});

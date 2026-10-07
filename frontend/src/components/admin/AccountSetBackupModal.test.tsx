import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn(), restore: vi.fn(), cancel: vi.fn() }));
vi.mock('../../api/accountSetBackup', () => ({ uploadBackup: mocks.upload, refreshBackupPreview: mocks.refresh, confirmBackupRestore: mocks.restore, cancelBackupPreview: mocks.cancel }));
import AccountSetBackupModal from './AccountSetBackupModal';

const preview = { token: 'task', month: '2026-06', fingerprint: 'fp', source_locked: false,
  blockers: [], summary: { new: 0, changed: 1, system_only: 0, same: 0 },
  rows: [{ key: 'daily:1', dataset: 'daily_records', identity: '["E1","2026-06-03"]', status: 'changed', enabled: true,
    system: { actual_hours: 6 }, backup: { actual_hours: 8 }, default_choice: 'system', affected_months: ['2026-06'],
    fields: [{ name: 'actual_hours', label: '实际工时', system: 6, backup: 8, delta: 2 }] }] };
beforeEach(() => { vi.resetAllMocks(); mocks.upload.mockResolvedValue(preview); mocks.refresh.mockResolvedValue(preview); mocks.restore.mockResolvedValue({ account_set_id: 1, counts: {new: 0, updated: 1, deleted: 0, skipped: 0}, warnings: [] }); });
afterEach(cleanup);
async function upload() {
  fireEvent.change(screen.getByLabelText('选择账套备份'), { target: { files: [new File(['x'], 'backup.zip')] } });
  await screen.findByText('2026-06 账套备份');
}
it('shows differences and sends the selected side only after confirmation', async () => {
  const done = vi.fn(); render(<AccountSetBackupModal onClose={() => {}} onRestored={done} />);
  await upload();
  expect(screen.getByLabelText('员工资料')).not.toBeChecked();
  expect(screen.getByText('差额')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '冲突以备份为准' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '查看导入确认' }));
  expect(mocks.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('task', expect.objectContaining({ choices: { 'daily:1': 'backup' } })));
  expect(done).toHaveBeenCalledWith(1);
});
it('refreshes options and prevents restoring missing references', async () => {
  mocks.refresh.mockResolvedValue({ ...preview, blockers: [{code:'missing_employee', message:'缺少员工 E1'}] });
  render(<AccountSetBackupModal onClose={() => {}} onRestored={() => {}} />);
  await upload(); fireEvent.click(screen.getByLabelText('员工资料'));
  await screen.findByText('缺少员工 E1');
  expect(screen.getByRole('button', {name: '查看导入确认'})).toBeDisabled();
  expect(mocks.refresh).toHaveBeenCalledWith('task', expect.objectContaining({employees: true}), {});
});
it('returns to preview when the target changes', async () => {
  const { ApiError } = await import('../../api/client');
  mocks.restore.mockRejectedValue(new ApiError('系统数据已变化', 409, {}));
  render(<AccountSetBackupModal onClose={() => {}} onRestored={() => {}} />);
  await upload(); fireEvent.click(screen.getByRole('button', {name:'查看导入确认'}));
  fireEvent.click(screen.getByRole('button', {name:'确认导入'}));
  await screen.findByText(/系统数据已变化/);
  expect(screen.getByRole('button', {name:'查看导入确认'})).toBeInTheDocument();
});

it('uploads a dropped ZIP and highlights the drop area', async () => {
  render(<AccountSetBackupModal onClose={() => {}} onRestored={() => {}} />);
  const zone = screen.getByRole('region', {name: '上传账套备份'});
  const file = new File(['x'], 'backup.zip');
  fireEvent.dragEnter(zone, {dataTransfer: {types: ['Files']}});
  expect(zone).toHaveClass('is-dragging');
  fireEvent.drop(zone, {dataTransfer: {files: [file]}});
  await screen.findByText('2026-06 账套备份');
  expect(mocks.upload).toHaveBeenCalledWith(file);
});
it('rejects multiple files and non-ZIP drops without uploading', () => {
  render(<AccountSetBackupModal onClose={() => {}} onRestored={() => {}} />);
  const zone = screen.getByRole('region', {name: '上传账套备份'});
  fireEvent.drop(zone, {dataTransfer: {files: [new File(['x'], 'a.zip'), new File(['x'], 'b.zip')]}});
  expect(screen.getByRole('alert')).toHaveTextContent('请每次上传一个账套备份');
  fireEvent.drop(zone, {dataTransfer: {files: [new File(['x'], 'a.xlsx')]}});
  expect(screen.getByRole('alert')).toHaveTextContent('请选择 ZIP 格式的账套备份');
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('ignores another dropped file while uploading', () => {
  mocks.upload.mockReturnValue(new Promise(() => {}));
  render(<AccountSetBackupModal onClose={() => {}} onRestored={() => {}} />);
  const zone = screen.getByRole('region', {name: '上传账套备份'});
  const file = new File(['x'], 'a.zip');
  fireEvent.drop(zone, {dataTransfer: {files: [file]}});
  fireEvent.drop(zone, {dataTransfer: {files: [file]}});
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});

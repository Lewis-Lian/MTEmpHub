import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const download = vi.hoisted(() => vi.fn());
vi.mock('../../api/accountSetBackup', async original => ({...await original<object>(), downloadMonthlyBackup: download}));
import MonthlyBackupExportModal from './MonthlyBackupExportModal';
import type { BackupExportProgress } from '../../api/accountSetBackup';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
it('does not export a default account that is absent from the month list', async () => {
  download.mockResolvedValue(undefined);
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-12'}]} initialId={2} onClose={() => {}} />);
  expect(screen.getByRole('button', {name: '开始导出'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('2026-12'));
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(download).toHaveBeenCalledWith([1], expect.any(Array), expect.any(Function));
  await screen.findByRole('button', {name: '开始导出'});
});
it('does not export a checked account removed from the visible month list', async () => {
  download.mockResolvedValue(undefined);
  const {rerender} = render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-12'}, {id: 2, month: '2027-01'}]} initialId={2} onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText('2026-12'));
  rerender(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-12'}]} initialId={2} onClose={() => {}} />);
  expect(screen.queryByLabelText('2027-01')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(download).toHaveBeenCalledWith([1], expect.any(Array), expect.any(Function));
  await screen.findByRole('button', {name: '开始导出'});
});
it('exports multiple checked months and all business categories without original files by default', async () => {
  download.mockResolvedValue(undefined);
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-06'}, {id: 2, month: '2026-07'}]} initialId={1} onClose={() => {}} />);
  expect(screen.getByLabelText('2026-06')).toBeChecked();
  fireEvent.click(screen.getByLabelText('2026-07'));
  ['账套参数与厂休', '考勤数据', '菜票核算与充值', '菜票独立台账', '当前部门资料', '当前员工资料', '班次与默认分配', '账号、密码与权限', '跨月请假与加班', '年度统计与年假'].forEach(label => expect(screen.getByLabelText(label)).toBeChecked());
  expect(screen.queryByLabelText('原始文件')).not.toBeInTheDocument();
  expect(screen.getByText(/不局限于所选月有业务记录/)).toBeInTheDocument();
  expect(screen.getByText(/100 MiB/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(download).toHaveBeenCalledWith([1, 2], ['account_settings', 'attendance', 'meal_tickets', 'meal_ledgers', 'departments', 'employees', 'shifts', 'accounts', 'cross_month', 'annual_stats'], expect.any(Function));
  await screen.findByRole('button', {name: '开始导出'});
});
it('reports actual stages, prevents duplicate downloads and retains completion', async () => {
  let finish!: () => void;
  download.mockImplementation((_ids, _categories, progress) => {
    progress({status: 'running', phase: 'packing', percent: 37, stage: '打包文件'});
    return new Promise<void>(resolve => { finish = () => {progress({status: 'completed', percent: 100, stage: '备份下载完成'}); resolve();}; });
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-06'}]} onClose={() => {}} />);
  expect(screen.getByRole('button', {name: '开始导出'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('2026-06'));
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
  expect(screen.getByRole('button', {name: '开始导出'})).toBeDisabled();
  finish();
  await screen.findByText('备份下载完成');
});
it.each([
  ['统计备份记录：2026-09/factory_rest', 'data'],
  ['读取备份数据：2026-09/factory_rest', 'data'],
  ['序列化备份数据', 'data'],
  ['打包备份文件', 'packing'],
  ['校验备份文件', 'verification'],
] as const)('shows indeterminate activity while %s has no measured total', (stage, phase) => {
  download.mockImplementation((_ids, _categories, progress) => {
    progress({status: 'running', phase, percent: null, stage, completed: 0, total: 0});
    return new Promise(() => {});
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText(stage)).toBeInTheDocument();
  expect(screen.getByText('处理中')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByRole('progressbar')).toHaveClass('acm-export-progress-track--indeterminate');
  expect(screen.queryByText(/(?:null|0)%/)).not.toBeInTheDocument();
});
it('shows measured record progress then clears it when the next stage has no measured total', () => {
  let report!: (progress: BackupExportProgress) => void;
  download.mockImplementation((_ids, _categories, progress) => {
    report = progress;
    progress({status: 'running', phase: 'data', percent: 37, stage: '读取备份数据：2026-09/daily_records', completed: 375, total: 1000, unit: 'records'});
    return new Promise(() => {});
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText('375 / 1,000 条记录')).toBeInTheDocument();
  expect(screen.getByText('37%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
  act(() => { report({status: 'running', phase: 'packing', percent: null, stage: '打包备份文件', completed: 0, total: 0}); });
  expect(screen.getByText('打包备份文件')).toBeInTheDocument();
  expect(screen.queryByText('37%')).not.toBeInTheDocument();
  expect(screen.queryByText(/条记录/)).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('');
});
it('keeps a measured zero percent determinate', () => {
  download.mockImplementation((_ids, _categories, progress) => {
    progress({status: 'running', phase: 'data', percent: 0, stage: '读取备份数据', completed: 0, total: 1000, unit: 'records'});
    return new Promise(() => {});
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText('0%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByRole('progressbar')).not.toHaveClass('acm-export-progress-track--indeterminate');
});
it('rounds the visible percentage down while retaining measured progress for the bar', () => {
  download.mockImplementation((_ids, _categories, progress) => {
    progress({status: 'running', phase: 'data', percent: 1.375137513751375, stage: '读取备份数据', completed: 250, total: 18180, unit: 'records'});
    return new Promise(() => {});
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText('1%')).toBeInTheDocument();
  expect(screen.queryByText('1.375137513751375%')).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1.375137513751375');
  expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({width: '1.375137513751375%'});
});
it('updates elapsed time before the first poll without inventing a percentage and stops after completion', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  download.mockImplementation((_ids, _categories, progress) => new Promise<void>(resolve => {
    finish = () => { progress({status: 'completed', phase: 'download', percent: 100, stage: '备份下载完成'}); resolve(); };
  }));
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText('等待服务器准备备份')).toBeInTheDocument();
  expect(screen.getByText(/已用时 0 秒/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText(/已用时 3 秒/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  await act(async () => { finish(); });
  expect(screen.getByText('备份下载完成')).toBeInTheDocument();
  expect(screen.queryByText(/已用时/)).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps downloads with an unknown content length indeterminate', () => {
  download.mockImplementation((_ids, _categories, progress) => {
    progress({status: 'running', phase: 'download', percent: 0, stage: '下载备份（已接收 512 字节）', completed: 512});
    return new Promise(() => {});
  });
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-09'}]} initialId={1} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(screen.getByText('接收中')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByRole('progressbar')).toHaveClass('acm-export-progress-track--indeterminate');
});

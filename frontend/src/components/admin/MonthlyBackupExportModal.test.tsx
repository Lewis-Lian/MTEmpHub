import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const download = vi.hoisted(() => vi.fn());
vi.mock('../../api/accountSetBackup', async original => ({...await original<object>(), downloadMonthlyBackup: download}));
import MonthlyBackupExportModal from './MonthlyBackupExportModal';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('exports multiple checked months and every category including accounts by default', async () => {
  download.mockResolvedValue(undefined);
  render(<MonthlyBackupExportModal accountSets={[{id: 1, month: '2026-06'}, {id: 2, month: '2026-07'}]} initialId={1} onClose={() => {}} />);
  expect(screen.getByLabelText('2026-06')).toBeChecked();
  fireEvent.click(screen.getByLabelText('2026-07'));
  ['账套参数与厂休', '考勤数据', '菜票核算与充值', '菜票独立台账', '原始文件', '当前部门资料', '当前员工资料', '班次与默认分配', '账号、密码与权限', '跨月请假与加班', '年度统计与年假'].forEach(label => expect(screen.getByLabelText(label)).toBeChecked());
  expect(screen.getByText(/不局限于所选月有业务记录/)).toBeInTheDocument();
  expect(screen.getByText(/100 MiB/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: '开始导出'}));
  expect(download).toHaveBeenCalledWith([1, 2], ['account_settings', 'attendance', 'meal_tickets', 'meal_ledgers', 'archives', 'departments', 'employees', 'shifts', 'accounts', 'cross_month', 'annual_stats'], expect.any(Function));
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

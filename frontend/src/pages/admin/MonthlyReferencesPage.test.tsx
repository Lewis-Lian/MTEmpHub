import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({listReferenceMonths: vi.fn(), fetchReferenceDetail: vi.fn(),
  previewReferenceOperation: vi.fn(), applyReferenceOperation: vi.fn()}));
vi.mock('../../api/monthlyReferences', () => api);
vi.mock('../../components/feedback/Notification', () => ({useNotification: () => ({success: vi.fn(), error: vi.fn()})}));
vi.mock('../../api/query', () => ({clearQueryBootstrapCache: vi.fn()}));
import MonthlyReferencesPage from './MonthlyReferencesPage';

const snapshot = {month: '2026-05', kind: 'employee', business_key: 'E1', payload: {name: '历史姓名', dept_no: 'D1'},
  quality: 'baseline', schema_version: 1, provenance: {source: 'current_baseline', fields: {name: 'baseline'}}};
const detail = {month: '2026-05', is_locked: false, snapshots: [snapshot],
  missing: [{kind: 'department', business_key: 'D2', payload: {dept_name: '财务'}}],
  current: [{kind: 'employee', business_key: 'E1', payload: {name: '当前姓名'}}],
  editable_fields: {employee: ['name', 'is_manager', 'dept_no'], department: ['dept_name'], shift: ['time_slots']},
  evidence: [{kind: 'employee', business_key: 'E1', field: 'name', conflict: true,
    candidates: [{value: '甲', sources: [{table: 'daily_records', id: 1}]}, {value: '乙', sources: [{table: 'monthly_reports', id: 2}]}]}],
  archives: []};

beforeEach(() => {
  api.listReferenceMonths.mockResolvedValue({months: [{month: '2026-05', name: '五月', is_locked: false,
    snapshot_count: 1, missing_count: 1, quality_counts: {baseline: 1, partial: 0, verified: 0}}]});
  api.fetchReferenceDetail.mockResolvedValue(detail);
  api.previewReferenceOperation.mockResolvedValue({month: '2026-05', action: 'capture', fingerprint: 'reviewed',
    required_categories: ['attendance'], changes: [{kind: 'department', business_key: 'D2', before: null,
      after: {...snapshot, kind: 'department', business_key: 'D2', payload: {dept_name: '财务'}}}]});
  api.applyReferenceOperation.mockResolvedValue({month: '2026-05', changed_count: 1});
});
afterEach(() => {cleanup(); vi.resetAllMocks();});

it('shows month quality and previews missing snapshots before confirmation', async () => {
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '预览补齐缺失快照'}));
  const dialog = await screen.findByRole('dialog', {name: '确认快照变更'});
  expect(dialog).toHaveTextContent('D2');
  expect(dialog).toHaveTextContent('财务');
  const apply = screen.getByRole('button', {name: '确认执行'});
  expect(apply).toBeDisabled();
  expect(api.applyReferenceOperation).not.toHaveBeenCalled();
  expect(screen.getByLabelText('我已核对变更，并了解基线资料不代表已验证历史')).toHaveFocus();
  fireEvent.click(screen.getByLabelText('我已核对变更，并了解基线资料不代表已验证历史'));
  fireEvent.click(apply);
  await waitFor(() => expect(api.applyReferenceOperation).toHaveBeenCalledWith('2026-05', {action: 'capture'}, 'reviewed'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('corrects a selected historical field with explicitly selected affected categories', async () => {
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '查看快照 E1'}));
  expect(screen.getByLabelText('修正值')).toHaveValue('历史姓名');
  fireEvent.change(screen.getByLabelText('修正值'), {target: {value: '修正姓名'}});
  fireEvent.click(screen.getByLabelText('考勤数据'));
  fireEvent.click(screen.getByRole('button', {name: '预览修正'}));
  await waitFor(() => expect(api.previewReferenceOperation).toHaveBeenCalledWith('2026-05', {
    action: 'correct', kind: 'employee', business_key: 'E1', changes: {name: '修正姓名'}, categories: ['attendance'],
  }));
});

it('does not choose conflicting evidence automatically', async () => {
  render(<MonthlyReferencesPage />);
  const choose = await screen.findByLabelText('E1 姓名：甲');
  expect(choose).not.toBeChecked();
  expect(screen.getByRole('button', {name: '预览采用所选证据'})).toBeDisabled();
  fireEvent.click(choose);
  fireEvent.click(screen.getByLabelText('考勤数据'));
  fireEvent.click(screen.getByRole('button', {name: '预览采用所选证据'}));
  await waitFor(() => expect(api.previewReferenceOperation).toHaveBeenCalledWith('2026-05', {
    action: 'reconcile', decisions: [{business_key: 'E1', field: 'name', value: '甲'}], categories: ['attendance'], inspect_archives: false,
  }));
});

it('allows inspection but disables writes for a locked month', async () => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, is_locked: true});
  render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('button', {name: '预览补齐缺失快照'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name: '查看快照 E1'}));
  expect(screen.getByRole('button', {name: '预览修正'})).toBeDisabled();
});

it('invalidates a rejected preview and requires another comparison', async () => {
  api.applyReferenceOperation.mockRejectedValue(new Error('资料已发生变化，请重新核对并预览'));
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '预览补齐缺失快照'}));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByLabelText('我已核对变更，并了解基线资料不代表已验证历史'));
  fireEvent.click(screen.getByRole('button', {name: '确认执行'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('资料已发生变化');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('never shows actions when the initial request fails', async () => {
  api.listReferenceMonths.mockRejectedValue(new Error('无权访问'));
  render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(screen.queryByRole('button', {name: '预览补齐缺失快照'})).not.toBeInTheDocument();
});

it('requires an explicit value when a legacy snapshot lacks a boolean field', async () => {
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '查看快照 E1'}));
  fireEvent.change(screen.getByLabelText('修正字段'), {target: {value: 'is_manager'}});
  expect(screen.getByLabelText('修正值')).toHaveValue('');
  expect(screen.getByRole('button', {name: '预览修正'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('修正值'), {target: {value: 'true'}});
  fireEvent.click(screen.getByLabelText('考勤数据'));
  fireEvent.click(screen.getByRole('button', {name: '预览修正'}));
  await waitFor(() => expect(api.previewReferenceOperation).toHaveBeenCalledWith('2026-05', {
    action: 'correct', kind: 'employee', business_key: 'E1', changes: {is_manager: true}, categories: ['attendance'],
  }));
});

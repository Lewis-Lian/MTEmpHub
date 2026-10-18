import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  fireEvent.click(await screen.findByRole('button', {name: '补齐缺失资料'}));
  const dialog = await screen.findByRole('dialog', {name: '保存 2026-05 的快照'});
  expect(dialog).toHaveTextContent('D2');
  expect(dialog).toHaveTextContent('财务');
  const apply = screen.getByRole('button', {name: '保存快照'});
  expect(apply).toBeEnabled();
  expect(api.applyReferenceOperation).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'关闭确认窗口'})).toHaveFocus();
  fireEvent.click(apply);
  await waitFor(() => expect(api.applyReferenceOperation).toHaveBeenCalledWith('2026-05', {action: 'capture'}, 'reviewed', expect.objectContaining({onProgress:expect.any(Function)})));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('allows inspection but disables writes for a locked month', async () => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, is_locked: true});
  render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('button', {name: '补齐缺失资料'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name: '查看资料 E1'}));
  expect(screen.queryByRole('button', {name: '检查修改内容'})).not.toBeInTheDocument();
});

it('invalidates a rejected preview and requires another comparison', async () => {
  api.applyReferenceOperation.mockRejectedValue(new Error('资料已发生变化，请重新核对并预览'));
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '补齐缺失资料'}));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', {name: '保存快照'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('资料已发生变化');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('never shows actions when the initial request fails', async () => {
  api.listReferenceMonths.mockRejectedValue(new Error('无权访问'));
  render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(screen.queryByRole('button', {name: '补齐缺失资料'})).not.toBeInTheDocument();
});

it('shows saved names and relationships without evidence or editing controls', async () => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots: [
    {...snapshot, payload: {...snapshot.payload, default_shift_no: 'S1'}},
    {...snapshot, kind: 'department', business_key: 'D1', payload: {dept_name: '生产部'}},
    {...snapshot, kind: 'shift', business_key: 'S1', payload: {shift_name: '白班'}},
  ]});
  render(<MonthlyReferencesPage />);
  expect(await screen.findByText('历史姓名')).toBeInTheDocument();
  expect(screen.getByText('生产部')).toBeInTheDocument();
  expect(screen.getByText('白班')).toBeInTheDocument();
  expect(screen.queryByText('当前姓名')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', {name: '核对历史报表'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('保存来源')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: '查看资料 E1'}));
  expect(screen.queryByLabelText('修改为')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('考勤统计')).not.toBeInTheDocument();
  expect(api.fetchReferenceDetail).toHaveBeenCalledWith('2026-05', false, expect.objectContaining({onProgress:expect.any(Function)}));
});

it('explains an uncaptured month and a fully saved month', async () => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots: []});
  const {unmount} = render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('button', {name: '生成本月快照'})).toBeEnabled();
  expect(screen.getByText('尚未保存本月资料')).toBeInTheDocument();
  unmount();
  api.fetchReferenceDetail.mockResolvedValue({...detail, missing: []});
  render(<MonthlyReferencesPage />);
  expect(await screen.findByText('本月资料已保存')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '资料已完整'})).toBeDisabled();
});

it('opens saved record in a read-only dialog and cancels without saving', async () => {
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '查看资料 E1'}));
  const dialog = screen.getByRole('dialog', {name: '查看资料'});
  expect(dialog).toHaveTextContent('历史姓名');
  fireEvent.click(screen.getByRole('button', {name: '关闭资料窗口'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.previewReferenceOperation).not.toHaveBeenCalled();
  expect(api.applyReferenceOperation).not.toHaveBeenCalled();
});

it.each([
  [{start: '8:00', end: '17:00'}],
  [{start_time: '8:00', end_time: '17:00'}],
  [['8:00', '17:00']],
])('shows saved shift periods in legacy format %j', async period => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots: [
    {...snapshot, kind: 'shift', business_key: 'S1', payload: {shift_name: '白班', time_slots: [period]}},
  ]});
  render(<MonthlyReferencesPage />);
  fireEvent.click(within(await screen.findByRole('group', {name: '资料类型'})).getByRole('button', {name: '班次'}));
  expect(screen.getByText('08:00—17:00')).toBeInTheDocument();
});

it('previews replacement and removed snapshots before rebuilding the selected month', async () => {
  api.previewReferenceOperation.mockResolvedValue({month: '2026-05', action: 'rebuild', fingerprint: 'rebuild-reviewed',
    required_categories: ['attendance'], changes: [
      {kind: 'employee', business_key: 'E1', before: snapshot, after: {...snapshot, payload: {name: '最新姓名'}}},
      {kind: 'employee', business_key: 'OLD', before: {...snapshot, business_key: 'OLD', payload: {name: '旧人员'}}, after: null},
    ]});
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name: '重建本月快照'}));
  const dialog = await screen.findByRole('dialog', {name: '重建 2026-05 的快照'});
  expect(api.previewReferenceOperation).toHaveBeenCalledWith('2026-05', {action: 'rebuild'}, expect.objectContaining({onProgress:expect.any(Function)}));
  expect(dialog).toHaveTextContent('替换');
  expect(dialog).toHaveTextContent('最新姓名');
  expect(dialog).toHaveTextContent('旧人员');
  expect(dialog).toHaveTextContent('删除');
  expect(within(dialog).getByRole('table')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('历史姓名');
  const confirm = screen.getByRole('button', {name: '替换旧快照'});
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.applyReferenceOperation).toHaveBeenCalledWith('2026-05', {action: 'rebuild'}, 'rebuild-reviewed', expect.objectContaining({onProgress:expect.any(Function)})));
});

it('disables rebuilding locked snapshots but permits rebuilding complete snapshots', async () => {
  api.fetchReferenceDetail.mockResolvedValue({...detail, missing: []});
  const {unmount} = render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('button', {name: '重建本月快照'})).toBeEnabled();
  unmount();
  api.fetchReferenceDetail.mockResolvedValue({...detail, is_locked: true});
  render(<MonthlyReferencesPage />);
  expect(await screen.findByRole('button', {name: '重建本月快照'})).toBeDisabled();
});

it('shows server counts during rebuild preview and indeterminate commit progress in the dialog', async () => {
  let report!: (value: unknown) => void;
  let finish!: (value: unknown) => void;
  api.previewReferenceOperation.mockImplementation((_month, _operation, options) => {
    report = options.onProgress;
    return new Promise(resolve => {finish = resolve;});
  });
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name:'重建本月快照'}));
  await waitFor(() => expect(report).toBeTypeOf('function'));
  const {act} = await import('@testing-library/react');
  act(() => report({status:'running', stage:'准备新快照', completed:3, total:8, percent:37.5}));
  const progress = screen.getByRole('progressbar', {name:'快照处理进度'});
  expect(progress).toHaveAttribute('aria-valuenow', '37.5');
  expect(screen.getByText(/3 \/ 8/)).toBeInTheDocument();
  act(() => finish({month:'2026-05', action:'rebuild', fingerprint:'reviewed', required_categories:[],
    changes:[{kind:'employee', business_key:'E1', before:snapshot, after:{...snapshot, payload:{name:'新姓名'}}}]}));
  await screen.findByRole('dialog');
  api.applyReferenceOperation.mockImplementation((_month, _operation, _fingerprint, options) => {
    options.onProgress({status:'running', stage:'正在提交保存', completed:0, total:0, percent:null});
    return new Promise(() => {});
  });
  fireEvent.click(screen.getByRole('button', {name:'替换旧快照'}));
  expect(screen.getByText('正在提交保存')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', {name:'快照处理进度'})).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByRole('button', {name:'替换旧快照'})).toBeDisabled();
});

it('shows clear category counts, named relationships and searchable change rows', async () => {
  api.previewReferenceOperation.mockResolvedValue({month:'2026-05', action:'rebuild', fingerprint:'reviewed', required_categories:[], changes:[
    {kind:'employee', business_key:'E1', before:{...snapshot, payload:{name:'历史姓名', dept_no:'D1'}}, after:{...snapshot, payload:{name:'新姓名', dept_no:'D2', is_manager:true}}},
    {kind:'department', business_key:'D2', before:null, after:{...snapshot, kind:'department', business_key:'D2', payload:{dept_name:'财务'}}},
  ]});
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots:[snapshot, {...snapshot, kind:'department', business_key:'D1', payload:{dept_name:'生产'}}]});
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name:'重建本月快照'}));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('生产');
  expect(dialog).toHaveTextContent('财务');
  expect(dialog).toHaveTextContent('管理人员');
  expect(dialog).not.toHaveTextContent('最后一步');
  expect(dialog.querySelector('details')).toBeNull();
  expect(within(dialog).getByRole('button', {name:'员工（1）'})).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('搜索本次资料'), {target:{value:'不存在'}});
  expect(dialog).not.toHaveTextContent('新姓名');
  fireEvent.change(within(dialog).getByLabelText('搜索本次资料'), {target:{value:''}});
  fireEvent.click(within(dialog).getByRole('button', {name:'部门（1）'}));
  expect(within(dialog).getByRole('table')).toHaveTextContent('财务');
  fireEvent.click(within(dialog).getByRole('button', {name:'取消'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.applyReferenceOperation).not.toHaveBeenCalled();
});

it('distinguishes a move between departments that have the same name', async () => {
  const department = {...snapshot, kind:'department', payload:{dept_name:'生产部'}};
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots:[snapshot, {...department, business_key:'D1'}, {...department, business_key:'D2'}]});
  api.previewReferenceOperation.mockResolvedValue({month:'2026-05', action:'rebuild', fingerprint:'reviewed', required_categories:[], changes:[
    {kind:'employee', business_key:'E1', before:snapshot, after:{...snapshot, payload:{name:'历史姓名', dept_no:'D2'}}},
  ]});
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name:'重建本月快照'}));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('生产部（D1）');
  expect(dialog).toHaveTextContent('生产部（D2）');
});

it('uses fresh preview relationship names and sorts changed values as text', async () => {
  const department = {...snapshot, kind:'department', business_key:'D1', payload:{dept_name:'页面旧名称'}};
  api.fetchReferenceDetail.mockResolvedValue({...detail, snapshots:[snapshot, department]});
  api.previewReferenceOperation.mockResolvedValue({month:'2026-05', action:'rebuild', fingerprint:'reviewed', required_categories:[], changes:[
    {kind:'employee', business_key:'E1', before:snapshot, after:{...snapshot, payload:{name:'Zed', dept_no:'D1'}}},
    {kind:'employee', business_key:'E2', before:null, after:{...snapshot, business_key:'E2', payload:{name:'Alpha', dept_no:'D1'}}},
    {kind:'department', business_key:'D1', before:{...department, payload:{dept_name:'预览前名称'}}, after:{...department, payload:{dept_name:'预览后名称'}}},
  ]});
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name:'重建本月快照'}));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('预览前名称');
  expect(dialog).toHaveTextContent('预览后名称');
  expect(dialog).not.toHaveTextContent('页面旧名称');
  fireEvent.click(within(dialog).getByRole('button', {name:'姓名'}));
  expect(within(dialog).getAllByRole('row')[1]).toHaveTextContent('Alpha');
});

it('keeps loaded data when a refresh is cancelled and never displays the internal abort error', async () => {
  render(<MonthlyReferencesPage />);
  await screen.findByText('历史姓名');
  api.listReferenceMonths.mockRejectedValueOnce(new DOMException('signal is aborted without reason', 'AbortError'));
  fireEvent.click(screen.getByRole('button', {name:'刷新资料'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'刷新资料'})).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('历史姓名')).toBeInTheDocument();
});

it('does not display cancellation of a snapshot preview as an error', async () => {
  api.previewReferenceOperation.mockRejectedValueOnce(new DOMException('signal is aborted without reason', 'AbortError'));
  render(<MonthlyReferencesPage />);
  fireEvent.click(await screen.findByRole('button', {name:'补齐缺失资料'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'补齐缺失资料'})).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(api.applyReferenceOperation).not.toHaveBeenCalled();
});

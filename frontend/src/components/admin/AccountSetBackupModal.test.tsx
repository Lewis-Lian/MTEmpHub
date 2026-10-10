import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MonthlyBackupPreview, MonthlyBackupRow, RestoreSelection } from '../../api/accountSetBackup';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn(), restore: vi.fn(), cancel: vi.fn() }));
vi.mock('../../api/accountSetBackup', async original => ({...await original<object>(), uploadMonthlyBackup: mocks.upload, refreshMonthlyBackupPreview: mocks.refresh, confirmMonthlyBackupRestore: mocks.restore, cancelMonthlyBackupPreview: mocks.cancel }));
import AccountSetBackupModal from './AccountSetBackupModal';

const selection: RestoreSelection = {months: ['2026-06', '2026-07'], categories: ['attendance', 'employees', 'accounts', 'cross_month', 'annual_stats'], cross_month_keys: [], annual_keys: []};
function row(dataset: string, category: string, identity: string, status: MonthlyBackupRow['status'], month: string | null = '2026-06'): MonthlyBackupRow {
  const scope = month ? `month/${month}/${dataset}` : `shared/${dataset}`;
  return {row_key: `${scope}/["${identity}"]`, scope, dataset, category, month, year: null, status, enabled: true,
    system: {}, backup: status === 'system_only' ? null : {}, default_choice: status === 'same' ? 'system' : 'backup', choice: status === 'same' ? 'system' : 'backup', affected_months: month ? [month] : [], reference_quality: {system:'baseline', backup:'partial'},
    fields: [{name:'actual_hours',label:'实际工时',system:6,backup:8,delta:2}]};
}
const rows = [row('daily_records','attendance','E1','changed'),row('daily_records','attendance','E2','new'),row('daily_records','attendance','E3','system_only'),row('daily_records','attendance','E7','changed','2026-07'),row('employees','employees','E4','system_only',null),row('users','accounts','admin','changed',null),
  {...row('leave_records','cross_month','L1','changed',null),scope:'cross_month/leave_records',row_key:'cross_month/leave_records/["L1"]', enabled:false,affected_months:['2026-06','2026-08']},
  {...row('annual_leave','annual_stats','A1','changed',null),scope:'year/2026/annual_leave',row_key:'year/2026/annual_leave/["A1"]',year:'2026',enabled:false,affected_months:['2026-01','2026-12']}];
rows[5].password_changed = true;
rows[5].fields = [{name:'password_changed',system:null,backup:null},{name:'profile_dept_no',system:'D1',backup:'D2'}];
const preview: MonthlyBackupPreview = {token:'task',months:['2026-06','2026-07'],selection,fingerprint:'fp',blockers:[],summary:{new:1,changed:4,system_only:2,same:0},rows,
 coverage:{'month/2026-06/daily_records':{included:true,complete:true},'month/2026-07/daily_records':{included:true,complete:true},'shared/employees':{included:true,complete:true},'shared/users':{included:true,complete:true},'month/2026-06/snapshots':{included:false,complete:false}}};
beforeEach(() => {
  vi.resetAllMocks(); mocks.upload.mockResolvedValue(preview);
  mocks.refresh.mockImplementation((_token, next, choices) => Promise.resolve({...preview,selection:next,months:next.months,rows: rows.map(r => ({...r,enabled: next.categories.includes(r.category) && (!r.month || next.months.includes(r.month)) && (!r.scope.startsWith('cross_month/') || next.cross_month_keys.includes(r.row_key)) && (!r.scope.startsWith('year/') || next.annual_keys.includes(r.row_key)), choice: choices[r.row_key] ?? r.default_choice}))}));
  mocks.restore.mockResolvedValue({task_id:'task',months:selection.months,counts:{new:1,updated:2,deleted:2,skipped:0},category_counts:{attendance:{new:1,updated:2,deleted:1}},warnings:[],reauthentication_required:false});
});
afterEach(cleanup);
async function upload() {
  fireEvent.change(screen.getByLabelText('选择账套备份'), {target:{files:[new File(['x'],'backup.zip')]}});
  await screen.findByText('识别到的月份');
}
function renderModal(done = vi.fn(), login = vi.fn()) { render(<AccountSetBackupModal onClose={() => {}} onRestored={done} onReauthenticate={login} />); return {done,login}; }
async function confirm() { fireEvent.click(screen.getByRole('button',{name:'查看导入确认'})); fireEvent.click(screen.getByRole('button',{name:'确认导入'})); }
it('recognizes actual included scope and explains incomplete or absent deletion and snapshot quality', async () => {
  renderModal(); await upload();
  expect(screen.getByLabelText('恢复月份 2026-06')).toBeChecked(); expect(screen.getByLabelText('恢复月份 2026-07')).toBeChecked();
  expect(screen.getByLabelText('恢复类别 账号、密码与权限')).toBeChecked();
  expect(screen.getByText(/未包含或不完整的范围不能按缺失删除/)).toBeInTheDocument();
  expect(screen.getAllByText(/资料不完整/).length).toBeGreaterThan(0);
  expect(screen.getByText(/密码：不同/)).toBeInTheDocument();
  expect(screen.queryByText('profile_dept_no')).not.toBeInTheDocument(); expect(screen.queryByText('password_changed')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'查看导入确认'}));
  expect(screen.getByText('退出当前资料')).toBeInTheDocument(); expect(screen.getByText('删除业务记录')).toBeInTheDocument();
});
it('keeps row checkmarks separate from choices and reports hidden checked rows', async () => {
  renderModal(); await upload();
  fireEvent.click(screen.getByLabelText('勾选 日报 E1')); fireEvent.click(screen.getByLabelText('勾选 日报 E7'));
  fireEvent.change(screen.getByLabelText('筛选月份'),{target:{value:'2026-06'}});
  expect(screen.getByText('已勾选 2 条，其中隐藏 1 条')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'所选行保留系统'}));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith('task', selection, {[rows[0].row_key]:'system',[rows[3].row_key]:'system'}));
  fireEvent.click(screen.getByLabelText('勾选 日报 E1'));
  fireEvent.click(screen.getByRole('button',{name:'重新预览'}));
  await waitFor(() => expect(mocks.refresh).toHaveBeenLastCalledWith('task', selection, {[rows[0].row_key]:'system',[rows[3].row_key]:'system'}));
});
it('selects only filtered enabled rows and batches new, changed and system-only rows', async () => {
  renderModal(); await upload();
  fireEvent.change(screen.getByLabelText('筛选月份'),{target:{value:'2026-06'}});
  fireEvent.change(screen.getByLabelText('筛选类别'),{target:{value:'attendance'}});
  fireEvent.click(screen.getByRole('button',{name:'勾选筛选结果（3 条）'}));
  fireEvent.click(screen.getByRole('button',{name:'所选行跳过'}));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith('task',selection,Object.fromEntries(rows.slice(0,3).map(r => [r.row_key,'skip']))));
  fireEvent.click(screen.getByRole('button',{name:'所选行采用备份'}));
  await waitFor(() => expect(mocks.refresh).toHaveBeenLastCalledWith('task',selection,Object.fromEntries(rows.slice(0,3).map(r => [r.row_key,'backup']))));
});
it('filters by status and keyword without changing decisions', async () => {
  renderModal(); await upload();
  fireEvent.change(screen.getByLabelText('筛选状态'),{target:{value:'system_only'}});
  fireEvent.change(screen.getByLabelText('关键词'),{target:{value:'E4'}});
  expect(screen.getByLabelText('勾选 员工资料 E4')).toBeInTheDocument(); expect(screen.queryByLabelText('勾选 日报 E3')).not.toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('selects partial months and categories and prunes only out-of-scope choices', async () => {
  renderModal(); await upload();
  fireEvent.change(screen.getByLabelText('采用方式 日报 E1'),{target:{value:'system'}});
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByLabelText('恢复月份 2026-07'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByLabelText('恢复类别 当前员工资料'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(3));
  await confirm();
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('task',{selection:{...selection,months:['2026-06'],categories:selection.categories.filter(c => c !== 'employees')},choices:{[rows[0].row_key]:'system'},fingerprint:'fp'}));
});
it('requires explicit cross-month and annual row keys, shows impact and does not auto-select dependencies', async () => {
  renderModal(); await upload();
  expect(screen.getByLabelText('采用方式 请假单 L1')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('恢复条目 请假单 L1'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith('task',{...selection,cross_month_keys:[rows[6].row_key]},{}));
  fireEvent.click(screen.getByLabelText('恢复条目 年度年假余额 A1'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith('task',{...selection,cross_month_keys:[rows[6].row_key],annual_keys:[rows[7].row_key]},{}));
  fireEvent.click(screen.getByRole('button',{name:'查看导入确认'}));
  expect(screen.getByText(/请假单 L1.*2026-08/)).toBeInTheDocument(); expect(screen.getByText(/年度年假余额 A1.*全年/)).toBeInTheDocument();
});
it('displays blockers and required record labels, permits confirmation review but prevents restore', async () => {
  mocks.upload.mockResolvedValue({...preview,blockers:[{code:'missing_employee',message:'缺少员工 E1',row_key:rows[0].row_key,required_rows:[rows[4].row_key]}]});
  renderModal(); await upload();
  expect(screen.getByText(/需要一并选择：员工资料 E4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'查看导入确认'}));
  expect(screen.getByRole('button',{name:'确认导入'})).toBeDisabled(); expect(screen.getByText('缺少员工 E1')).toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('keeps selection and decisions after a failed restore, supports re-comparing on 409', async () => {
  const {ApiError} = await import('../../api/client'); mocks.restore.mockRejectedValue(new ApiError('目标已变化',409,{}));
  renderModal(); await upload(); fireEvent.change(screen.getByLabelText('采用方式 日报 E1'),{target:{value:'system'}});
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1)); await confirm();
  await screen.findByText(/请重新比较/);
  fireEvent.click(screen.getByRole('button',{name:'重新预览'}));
  await waitFor(() => expect(mocks.refresh).toHaveBeenLastCalledWith('task',selection,{[rows[0].row_key]:'system'}));
  expect(screen.getByLabelText('采用方式 日报 E1')).toHaveValue('system');
});
it('displays successful result and warnings before login without making business reload requests', async () => {
  mocks.restore.mockResolvedValue({task_id:'task',months:selection.months,counts:{new:0,updated:1,deleted:0,skipped:0},category_counts:{},warnings:['旧文件清理稍后重试'],reauthentication_required:true});
  const {done,login} = renderModal(); await upload(); await confirm();
  await screen.findByText('账套恢复完成'); expect(screen.getByText('旧文件清理稍后重试')).toBeInTheDocument();
  expect(done).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'重新登录'})); expect(login).toHaveBeenCalledTimes(1);
});
it('refreshes caches after successful result and keeps result visible if refresh fails', async () => {
  const done = vi.fn(async () => {expect(screen.getByText('账套恢复完成')).toBeInTheDocument(); throw new Error('刷新失败');});
  renderModal(done); await upload(); await confirm();
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(screen.getByText('账套恢复完成')).toBeInTheDocument(); expect(await screen.findByText(/缓存刷新失败/)).toBeInTheDocument();
});
it('uploads a dropped ZIP, highlights drop area and cancels the task on close', async () => {
  const close = vi.fn(); render(<AccountSetBackupModal onClose={close} onRestored={vi.fn()} />);
  const zone = screen.getByRole('region',{name:'上传账套备份'}); const file = new File(['x'],'backup.zip');
  fireEvent.dragEnter(zone,{dataTransfer:{types:['Files']}}); expect(zone).toHaveClass('is-dragging');
  fireEvent.drop(zone,{dataTransfer:{files:[file]}}); await screen.findByText('识别到的月份');
  fireEvent.click(screen.getByRole('button',{name:'关闭备份导入'}));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('task')); expect(close).toHaveBeenCalled();
});
it('rejects multiple files, non-ZIP and oversized files without uploading', () => {
  renderModal(); const zone = screen.getByRole('region',{name:'上传账套备份'});
  fireEvent.drop(zone,{dataTransfer:{files:[new File(['x'],'a.zip'),new File(['x'],'b.zip')]}});
  expect(screen.getByRole('alert')).toHaveTextContent('请每次上传一个账套备份');
  fireEvent.drop(zone,{dataTransfer:{files:[new File(['x'],'a.xlsx')]}});
  expect(screen.getByRole('alert')).toHaveTextContent('请选择 ZIP 格式的账套备份');
  const large = new File(['x'],'a.zip'); Object.defineProperty(large,'size',{value:100*1024*1024+1});
  fireEvent.drop(zone,{dataTransfer:{files:[large]}}); expect(screen.getByRole('alert')).toHaveTextContent('100 MiB');
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('ignores another drop while upload is in progress', () => {
  mocks.upload.mockReturnValue(new Promise(() => {})); renderModal(); const zone = screen.getByRole('region',{name:'上传账套备份'}); const file = new File(['x'],'a.zip');
  fireEvent.drop(zone,{dataTransfer:{files:[file]}}); fireEvent.drop(zone,{dataTransfer:{files:[file]}}); expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it('progressively renders large differences, while filtered select-all covers all matching rows', async () => {
  const many = Array.from({length:125},(_,i) => row('daily_records','attendance',`E${i}`,'changed'));
  mocks.upload.mockResolvedValue({...preview,rows:many}); renderModal(); await upload();
  expect(screen.getAllByLabelText(/^勾选 日报/)).toHaveLength(100);
  fireEvent.click(screen.getByRole('button',{name:'勾选筛选结果（125 条）'}));
  expect(screen.getByText('已勾选 125 条，其中隐藏 25 条')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'显示更多差异'})); expect(screen.getAllByLabelText(/^勾选 日报/)).toHaveLength(125);
});
it('cannot batch-delete system-only rows from incomplete coverage and leaves absent categories unselected', async () => {
  const incomplete = {...rows[4],default_choice:'system' as const,choice:'system' as const};
  mocks.upload.mockResolvedValue({...preview,rows:[incomplete],selection:{...selection,categories:['employees']},coverage:{'shared/employees':{included:true,complete:false},'shared/users':{included:false,complete:false}}});
  renderModal(); await upload();
  expect(screen.getByLabelText('恢复类别 账号、密码与权限')).not.toBeChecked(); expect(screen.getByLabelText('恢复类别 账号、密码与权限')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('勾选 员工资料 E4'));
  fireEvent.click(screen.getByRole('button',{name:'所选行采用备份'}));
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(screen.getByText(/不完整范围的系统独有记录不能按缺失删除/)).toBeInTheDocument();
  expect(screen.getByLabelText('采用方式 员工资料 E4')).toHaveValue('system');
});
it('shows snapshot provenance and meaningful field values without raw structured keys or content hashes', async () => {
  const snapshot = row('snapshots','monthly_references','E1','changed');
  snapshot.backup = {provenance:{source:'current_baseline'}};
  snapshot.fields = [{name:'payload',system:{dept_no:'D1'},backup:{dept_no:'D2'}},{name:'source_digest',system:'HASH_BEFORE',backup:'HASH_AFTER'}];
  mocks.upload.mockResolvedValue({...preview,rows:[snapshot]}); renderModal(); await upload();
  expect(screen.getByText('备份快照来源：旧数据基线')).toBeInTheDocument();
  fireEvent.click(screen.getByText('查看字段差异（2 项）'));
  expect(await screen.findByText('部门编号：D1')).toBeInTheDocument(); expect(screen.getByText('部门编号：D2')).toBeInTheDocument();
  expect(screen.queryByText('dept_no')).not.toBeInTheDocument(); expect(screen.queryByText('HASH_BEFORE')).not.toBeInTheDocument();
});
it('labels all meal-ticket datasets and confirms recharge impact outside the selected months', async () => {
  const labels = {meal_batches:'菜票核算批次',meal_items:'菜票明细',meal_adjustments:'菜票补扣',meal_payments:'菜票充值与冲正',meal_followup_tasks:'菜票后续办理任务',meal_followup_allocations:'菜票任务资金分配',meal_imports:'菜票历史导入',meal_import_rows:'菜票导入明细',meal_ledger_records:'菜票独立台账记录',meal_ledger_imports:'菜票台账导入'};
  mocks.upload.mockResolvedValue({...preview,selection:{...selection,categories:['meal_tickets','meal_ledgers','archives']},rows:Object.keys(labels).map(dataset => ({...row(dataset,dataset.startsWith('meal_ledger') ? 'meal_ledgers' : 'meal_tickets','M1','changed'),affected_months:['2026-06','2026-08']}))});
  renderModal(); await upload(); Object.values(labels).forEach(label => expect(screen.getByLabelText(`勾选 ${label} M1`)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'查看导入确认'})); expect(screen.getByText(/菜票核算批次 M1.*2026-08/)).toBeInTheDocument();
});
it('retains choices after a business failure and prevents confirm until a new comparison succeeds', async () => {
  mocks.restore.mockRejectedValue(new Error('资金来源不匹配')); renderModal(); await upload();
  fireEvent.change(screen.getByLabelText('采用方式 日报 E1'),{target:{value:'skip'}}); await waitFor(() => expect(mocks.refresh).toHaveBeenCalled()); await confirm();
  await screen.findByText('资金来源不匹配'); expect(screen.getByLabelText('采用方式 日报 E1')).toHaveValue('skip');
  expect(screen.getByRole('button',{name:'查看导入确认'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新预览'})); await waitFor(() => expect(screen.getByRole('button',{name:'查看导入确认'})).toBeEnabled());
});
it('searches human names and translates dependency field names in blocker messages', async () => {
  const named = {...rows[0],backup:{name:'张三'}};
  mocks.upload.mockResolvedValue({...preview,rows:[named],blockers:[{code:'missing_department',message:'缺少关联资料 profile_dept_no：D1；请保留或一并选择对应记录'}]});
  renderModal(); await upload(); fireEvent.change(screen.getByLabelText('关键词'),{target:{value:'张三'}});
  expect(screen.getByLabelText('勾选 日报 E1 · 张三')).toBeInTheDocument();
  expect(screen.getByText('缺少关联资料 账号所属部门：D1；请保留或一并选择对应记录')).toBeInTheDocument();
});
it('renders field tables only when a user expands a difference', async () => {
  mocks.upload.mockResolvedValue({...preview,rows:[rows[0]]}); renderModal(); await upload();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('查看字段差异（1 项）'));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.getByText('实际工时')).toBeInTheDocument();
});

import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import MealTicketPage from './MealTicketPage';
import { ConfirmProvider } from '../components/feedback/ConfirmDialog';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../api/client',()=>({apiRequest: async (path: string, options?: object) => {
  const result = await request(path, options);
  if (path.includes("followup-tasks") && !Array.isArray(result?.tasks)) return {
    batch_id: result?.id ?? 1, batch_version: result?.version ?? 1, offset_enabled: true, settings_digest: "s",
    queue_offset_enabled: true, settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: null, tasks: [],
  };
  return result;
},buildApiUrl:(p:string)=>p}));
const item={id:1,emp_id:1,emp_no:'001',name:'员工甲',dept_name:'生产部',is_manager:false,days:22,
  base_amount:176,adjustment_amount:0,due_amount:176,paid_amount:0,difference:176,error:'',source:{},
  employment_status:'active',resigned_at:null,excluded:false,original_base_amount:176,
  participation_history:[],adjustments:[],payments:[]};
const batch={id:1,month:'2026-08',recharge_month:'2026-09',status:'confirmed',version:2,
  source_changed:false,database:{enabled:true,configured:true},items:[item],departments:[]};
beforeEach(()=>{request.mockReset();sessionStorage.clear();HTMLElement.prototype.scrollIntoView=vi.fn();});
it('草稿核算异常仍提示，但到账核对卡片在结清步骤前隐藏', async () => {
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    {...batch,status:'draft',items:[{...item,error:'缺少考勤来源'}]}));
  page();
  await screen.findByText('员工甲');
  expect(screen.getByRole('list',{name:'月度发放流程'}).querySelector('[aria-current="step"]')).toHaveTextContent('计算与核对');
  expect(screen.getByRole('region',{name:'整月结清检查'})).toHaveTextContent('草稿待核算');
  expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('核对开始日期')).not.toBeInTheDocument();
});
it('已确认来源变化引导到后续页处理', async () => {
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:{...batch,source_changed:true}));
  page();
  await screen.findByText('员工甲');
  expect(screen.getByText(/请前往后续补扣与对账页核对差额/)).toBeInTheDocument();
});
it('后续补扣预览考勤差额，确认后保留基础金额和已发金额', async () => {
  let current={...batch,source_changed:true,items:[{...item,paid_amount:176,difference:0}]};
  request.mockImplementation((path:string)=> {
    if(path==='/api/auth/me') return Promise.resolve({role:'admin'});
    if(path==='/api/meal-tickets/attendance-recalculation/preview') return Promise.resolve({batch_id:1,version:2,source_digest:'new-source',issues:[],rows:[{item_id:1,emp_no:'001',name:'员工甲',previous_days:22,days:23,amount:8,excluded:false}],total_amount:8});
    if(path==='/api/meal-tickets/attendance-recalculation') current={...current,version:3,source_changed:false,items:[{...current.items[0],adjustment_amount:8,due_amount:184,difference:8}]};
    return Promise.resolve(current);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'重算考勤数据'}));
  const dialog=await screen.findByRole('dialog',{name:'考勤重算差额'});
  expect(within(dialog).getByText('23')).toBeInTheDocument();
  expect(within(dialog).getByText('8.00')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button',{name:'确认登记考勤补扣'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'考勤重算差额'})).not.toBeInTheDocument());
  const row=screen.getByText('员工甲').closest('tr')!;
  expect(within(row).getByText('184.00')).toBeInTheDocument();
  expect(within(row).getAllByText('176.00')).toHaveLength(2);
});
it('新增人员需核对原因才能补入，补入后刷新预览并可继续重算', async () => {
  const newPerson = {...item,id:3,emp_id:3,emp_no:'003',name:'新增员工',days:5,
    base_amount:40,original_base_amount:40,due_amount:40,difference:40};
  let current = batch;
  request.mockImplementation((path:string) => {
    if (path === '/api/auth/me') return Promise.resolve({role:'admin'});
    if (path === '/api/meal-tickets/supplement-person') current = {...batch,version:3,items:[item,newPerson]};
    if (path === '/api/meal-tickets/attendance-recalculation/preview') return Promise.resolve({
      batch_id:1,version:current.version,source_digest:'new-source',total_amount:0,rows:[],
      issues:current.version === 2 ? ['003 新增员工 不在原核算名单，请人工核对'] : [],
      new_people:current.version === 2 ? [{emp_id:3,emp_no:'003',name:'新增员工',dept_name:'生产部',days:5,base_amount:40,error:''}] : []});
    return Promise.resolve(current);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'重算考勤数据'}));
  const dialog = await screen.findByRole('dialog',{name:'考勤重算差额'});
  const add = within(dialog).getByRole('button',{name:'核对并补入本月核算'});
  expect(add).toBeDisabled();
  expect(within(dialog).getByRole('button',{name:'确认登记考勤补扣'})).toBeDisabled();
  expect(within(dialog).getByText('40.00')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('003 补入原因'),{target:{value:'核对后补入'}});
  fireEvent.click(add);
  await waitFor(() => expect(within(screen.getByRole('dialog',{name:'考勤重算差额'}))
    .getByRole('button',{name:'确认登记考勤补扣'})).toBeEnabled());
  const refreshed = screen.getByRole('dialog',{name:'考勤重算差额'});
  expect(within(refreshed).queryByRole('button',{name:'核对并补入本月核算'})).not.toBeInTheDocument();
  fireEvent.click(within(refreshed).getByRole('button',{name:'取消'}));
  expect(screen.getByText('新增员工')).toBeInTheDocument();
});
function page() {
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/calculation?recharge_month=2026-09']}><MealTicketPage/></MemoryRouter></ConfirmProvider>);
}
it('月度结清后保留摘要和唯一下载入口，明细按需展开', async () => {
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    {...batch,items:[{...item,paid_amount:176,difference:0}]}));
  page();
  await screen.findByText('本月账目已结清');
  const completion=screen.getByRole('region',{name:'整月结清检查'});
  expect(completion).toHaveClass('is-settled');
  expect(completion.closest('main')).toHaveClass('is-settlement-complete');
  expect(completion.querySelector('.meal-ticket-check-ring')).toHaveAttribute('pathLength','1');
  expect(completion.querySelector('.meal-ticket-checkmark')).toHaveAttribute('d','m7 12 3 3 7-7');
  expect(completion.querySelector('path[d="M12 7v6"]')).toBeNull();
  expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'人员明细'})).not.toBeVisible();
  expect(screen.getAllByRole('link',{name:'导出充值表（.xls）'})).toHaveLength(1);
  expect(screen.queryByRole('button',{name:'前往导出'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'核对到账与结清'})).not.toBeInTheDocument();
  expect(within(screen.getByRole('region',{name:'整月结清检查'})).queryByRole('button')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('查看核算明细'));
  expect(screen.getByRole('region',{name:'人员明细'})).toBeVisible();
  const flow=screen.getByRole('list',{name:'月度发放流程'});
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('核对到账');
});
it.each(['preview', 'apply'])('切换月份后忽略旧月份的考勤重算 %s 响应', async stage => {
  let resolveOld!: (value: unknown) => void;
  const delayed = new Promise(resolve => { resolveOld = resolve; });
  const preview = {batch_id:1,version:2,source_digest:'new-source',issues:[],rows:[],total_amount:0};
  const nextMonth = {...batch,id:2,month:'2026-09',recharge_month:'2026-10',items:[{...item,name:'十月员工'}]};
  request.mockImplementation((path:string) => {
    if (path === '/api/auth/me') return Promise.resolve({role:'admin'});
    if (path === '/api/meal-tickets/attendance-recalculation/preview') return stage === 'preview' ? delayed : Promise.resolve(preview);
    if (path === '/api/meal-tickets/attendance-recalculation') return delayed;
    return Promise.resolve(path.includes('recharge_month=2026-10') ? nextMonth : batch);
  });
  function Navigation() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/meal-tickets/payments?recharge_month=2026-10')}>换到十月</button>;
  }
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/payments?recharge_month=2026-09']}><Navigation/><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'重算考勤数据'}));
  if (stage === 'apply') fireEvent.click(await screen.findByRole('button',{name:'确认登记考勤补扣'}));
  fireEvent.click(screen.getByRole('button',{name:'换到十月'}));
  await act(async () => { resolveOld(stage === 'preview' ? preview : batch); await delayed; });
  await screen.findByText('十月员工');
  expect(screen.queryByRole('dialog',{name:'考勤重算差额'})).not.toBeInTheDocument();
  expect(screen.getByText('十月员工')).toBeInTheDocument();
  expect(screen.getByLabelText('计划充值月份')).toHaveValue('2026-10');
});
it('取款流水需分类，月末清零不会显示为核算扣回', async () => {
  const report = { checked_at: '2026-10-08T16:00:00', start_date: '2026-09-01', end_date: '2026-09-30', added: 1, existing: 0, unmatched: 0, zero_amount: 0, outside_subsidy_month: 0, sources: { subsidy: 1, recharge: 0, refund: 0 }, pending_refunds: [{ id: 12, emp_no: '001', name: '员工甲', date: '2026-09-30', amount: 20 }] };
  request.mockImplementation((path: string, options?: { body?: { refund_actions?: object } }) => Promise.resolve(path === '/api/auth/me' ? { role: 'admin' } : path === '/api/meal-tickets/reconcile' && options?.body?.refund_actions ?
    { ...batch, items: [{ ...item, paid_amount: 176, difference: 0 }], reconciliation: { ...report, pending_refunds: [] } } : { ...batch, reconciliation: report }));
  page();
  await screen.findByLabelText('流水 12 分类');
  expect(screen.queryByText('本月账目已结清')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('流水 12 分类'), { target: { value: 'clearance' } });
  fireEvent.click(screen.getByRole('button', { name: '核对到账' }));
  expect(await screen.findByText('本月账目已结清')).toBeInTheDocument();
});
it('读取数据库后全部结清，自动隐藏操作区域',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    path==='/api/meal-tickets/reconcile'?{...batch,version:3,items:[{...item,paid_amount:176,difference:0}]}:batch));
  page();
  const panel=await screen.findByRole('region',{name:'到账核对'});
  const pending=screen.getByRole('region',{name:'整月结清检查'});
  expect(pending).not.toHaveClass('is-settled');
  expect(pending.closest('main')).not.toHaveClass('is-settlement-complete');
  expect(pending.querySelector('.meal-ticket-check-ring')).toBeNull();
  expect(pending.querySelector('.meal-ticket-checkmark')).toBeNull();
  expect(screen.getByRole('region',{name:'人员明细'})).toBeInTheDocument();
  expect(screen.getByRole('region',{name:'充值表导出'})).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button',{name:/已完成充值，核对到账|^核对到账$/}));
  await screen.findByText('本月账目已结清');
  expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'人员明细'})).not.toBeVisible();
  expect(screen.getAllByRole('link',{name:'导出充值表（.xls）'})).toHaveLength(1);
});
it('数据库核对按选定日期更新账目，未结清时展示实际流水及重复记录数',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    path==='/api/meal-tickets/reconcile'?{...batch,version:3,items:[{...item,paid_amount:160,difference:16}],
      reconciliation:{checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-10-06',added:3,existing:2,unmatched:1,zero_amount:1,outside_subsidy_month:0,sources:{subsidy:1,recharge:1,refund:1}}}:batch));
  page();
  const panel=await screen.findByRole('region',{name:'到账核对'});
  expect(screen.queryByRole('button',{name:'登记充值'})).not.toBeInTheDocument();
  fireEvent.change(within(panel).getByLabelText('核对结束日期'),{target:{value:'2026-10-06'}});
  fireEvent.click(within(panel).getByRole('button',{name:/已完成充值，核对到账|^核对到账$/}));
  expect(await within(panel).findByText('新增 3 条 · 已登记 2 条')).toBeInTheDocument();
  expect(screen.getByText('还有差额需要处理')).toBeInTheDocument();
  expect(within(panel).getByText(/未匹配本月人员 1 条/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/reconcile',expect.objectContaining({method:'POST',body:{batch_id:1,version:2,start_date:'2026-09-01',end_date:'2026-10-06'}}));
});
it('数据库读取失败保留待发账目并显示错误',async()=>{
  request.mockImplementation((path:string)=>path==='/api/auth/me'?Promise.resolve({role:'admin'}):
    path==='/api/meal-tickets/reconcile'?Promise.reject(new Error('共享数据库读取失败')):Promise.resolve(batch));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  fireEvent.click(within(screen.getByRole('region',{name:'到账核对'})).getByRole('button',{name:/已完成充值，核对到账|^核对到账$/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('共享数据库读取失败');
  expect(within(panel).getByText('数据库核对未完成')).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'核对到账'})).toHaveLength(1);
});
it('只读账号查看到账结果，不发起数据库入账',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'readonly'}:batch));
  page();
  await screen.findByText('员工甲');
  expect(screen.queryByRole('button',{name:/已完成充值，核对到账|^核对到账$/})).not.toBeInTheDocument();
});
it('已由数据库登记的账目关闭开关后显示暂停，不开放手工重复登记',async()=>{
  const current={...batch,database:{enabled:false,configured:true},items:[{...item,paid_amount:160,difference:16,
    payments:[{id:1,kind:'recharge',amount:160,date:'2026-09-04',reference:'数据库补贴发放',operator:'admin',reversed:false,database_record:true}]}]};
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:current));
  page();
  await screen.findByText('员工甲');
  expect(screen.queryByRole('button',{name:'登记充值'})).not.toBeInTheDocument();
  expect(screen.getByText('数据库核对已暂停')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/已完成充值，核对到账|^核对到账$/})).toBeDisabled();
});
it('原账金额平衡但流水待分类，本次数据库读取失败时不显示结清成功',async()=>{
  request.mockImplementation((path:string)=>path==='/api/auth/me'?Promise.resolve({role:'admin'}):
    path==='/api/meal-tickets/reconcile'?Promise.reject(new Error('已登记流水发生变化')):
    Promise.resolve({...batch,items:[{...item,paid_amount:176,difference:0}],reconciliation:{
      checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-09-30',added:0,existing:0,
      unmatched:0,zero_amount:0,outside_subsidy_month:0,sources:{subsidy:0,recharge:0,refund:0},
      pending_refunds:[{id:12,emp_no:'001',name:'员工甲',date:'2026-09-30',amount:20}]
    }}));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  expect(within(panel).queryByLabelText('核对开始日期')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region',{name:'到账核对'})).getByRole('button',{name:/已完成充值，核对到账|^核对到账$/}));
  await screen.findByRole('alert');
  expect(within(panel).queryByText('本月账目已结清')).not.toBeInTheDocument();
  expect(within(panel).getByText('数据库核对未完成')).toBeInTheDocument();
});

it('数据库模式月度固定四阶段，步骤条不提供操作',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:batch));
  page();
  await screen.findByText('员工甲');
  const flow=screen.getByRole('list',{name:'月度发放流程'});
  expect(within(flow).getAllByRole('listitem').map(step=>within(step).getByRole('heading').textContent))
    .toEqual(['选月份','计算与核对','导出并充值','核对到账']);
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('导出并充值');
  expect(within(flow).queryByRole('button')).not.toBeInTheDocument();
});

it('数据库模式后续补扣三阶段导航无按钮，核对只有一个入口', async () => {
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:batch));
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByText('员工甲');
  const flow=screen.getByRole('list',{name:'后续补扣流程'});
  expect(within(flow).getAllByRole('heading').map(step=>step.textContent)).toEqual(['登记补扣','逐人办理','核对结果']);
  expect(within(flow).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'核对结果'})).toHaveLength(1);
});
it.each([false,true])('后续页按真实金额显示结果，结清状态为 %s，仍能登记补扣',async settled=>{
  const current={...batch,items:[{...item,paid_amount:settled?176:0,difference:settled?0:176}]};
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:current));
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByRole('button',{name:'导入补扣清单'});
  if (settled) {
    await screen.findByText('本月账目已结清');
    expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
    expect(screen.queryByText('员工甲')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('显示全部人员'));
  } else expect(screen.getByRole('region',{name:'到账核对'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'补扣'})).toBeEnabled();
  expect(request.mock.calls.some(([path])=>path==='/api/meal-tickets/reconcile')).toBe(false);
});
it('后续保存补扣自动刷新清单，不需要手动下一步', async () => {
  let current={...batch,items:[{...item,paid_amount:176,difference:0}]};
  const empty = {batch_id:1,batch_version:2,offset_enabled:true,settings_digest:'s',queue_offset_enabled:true,settings_changed:false,baseline_required:false,baseline_reason:'',current_task_key:null,tasks:[]};
  const task = {key:'task',item_key:'i',emp_no:'001',name:'员工甲',dept_name:'生产部',kind:'recharge',status:'pending',amount_cents:1600,allocated_cents:0,remaining_cents:1600,version:1};
  request.mockImplementation((path:string)=>{
    if(path==='/api/auth/me')return Promise.resolve({role:'admin'});
    if(path==='/api/meal-tickets/adjustments')current={...current,version:3,items:[{...current.items[0],adjustment_amount:16,due_amount:192,difference:16}]};
    if(path.includes('followup-tasks'))return Promise.resolve(current.version===2?empty:{...empty,batch_version:3,current_task_key:'task',tasks:[task]});
    return Promise.resolve(current);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByRole('button',{name:'导入补扣清单'});
  fireEvent.click(screen.getByLabelText('显示全部人员'));
  fireEvent.click(screen.getByRole('button',{name:'补扣'}));
  fireEvent.change(screen.getByLabelText('调整金额（元）'),{target:{value:'16'}});
  fireEvent.click(screen.getByRole('button',{name:'线长补卡'}));
  fireEvent.click(screen.getByRole('button',{name:'保存补扣'}));
  await screen.findByRole('button',{name:'已完成充值，下一人'});
  expect(screen.getByRole('list',{name:'后续补扣流程'}).querySelector('[aria-current="step"]')).toHaveTextContent('逐人办理');
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/followup-tasks/refresh',expect.objectContaining({body:expect.objectContaining({version:3,settings_digest:'s'})}));
  expect(screen.queryByRole('button',{name:/下一步：/})).not.toBeInTheDocument();
});
it('多选流水批量分类，未选流水保持原分类，全选支持取消', async () => {
  const pending_refunds = [12, 13, 14].map((id, index) => ({id, emp_no: `00${index + 1}`, name: `员工${index + 1}`, date: '2026-09-30', amount: 20}));
  request.mockImplementation((path: string) => Promise.resolve(path === '/api/auth/me' ? {role:'admin'} : {...batch, reconciliation: {checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-09-30',added:0,existing:0,unmatched:0,zero_amount:0,outside_subsidy_month:0,sources:{subsidy:0,recharge:0,refund:0},pending_refunds}}));
  page();
  fireEvent.click(await screen.findByLabelText('选择流水 12'));
  fireEvent.click(screen.getByLabelText('选择流水 13'));
  expect(screen.getByText('已选 2 条 · 40.00 元')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'批量设为月末余额清零'}));
  expect(screen.getByLabelText('流水 12 分类')).toHaveValue('clearance');
  expect(screen.getByLabelText('流水 13 分类')).toHaveValue('clearance');
  expect(screen.getByLabelText('流水 14 分类')).toHaveValue('');
  expect(screen.getByRole('button',{name:'核对到账'})).toBeDisabled();
  const all = screen.getByLabelText('全选待分类流水');
  expect(all).toBePartiallyChecked();
  fireEvent.click(all);
  expect(screen.getByText('已选 3 条 · 60.00 元')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'批量设为菜票扣回'}));
  expect(screen.getByLabelText('流水 14 分类')).toHaveValue('refund');
  expect(screen.getByRole('button',{name:'核对到账'})).toBeEnabled();
  fireEvent.click(all);
  expect(screen.getByRole('button',{name:'批量设为菜票扣回'})).toBeDisabled();
});
it('同月刷新移除已处理流水的选择和分类', async () => {
  const rows = [12, 13].map(id => ({id,emp_no:'001',name:'员工甲',date:'2026-09-30',amount:20}));
  let refreshed = false;
  request.mockImplementation((path:string) => Promise.resolve(path === '/api/auth/me' ? {role:'admin'} : {...batch,reconciliation:{checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-09-30',added:0,existing:0,unmatched:0,zero_amount:0,outside_subsidy_month:0,sources:{subsidy:0,recharge:0,refund:0},pending_refunds:refreshed ? rows.slice(1) : rows}}));
  function Navigation() {
    const navigate = useNavigate();
    return <button onClick={() => { refreshed = true; navigate('/meal-tickets/calculation?recharge_month=2026-09&refresh=1'); }}>刷新本月</button>;
  }
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/calculation?recharge_month=2026-09']}><Navigation/><MealTicketPage/></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByLabelText('选择流水 12'));
  fireEvent.click(screen.getByRole('button',{name:'批量设为月末余额清零'}));
  fireEvent.click(screen.getByRole('button',{name:'刷新本月'}));
  await waitFor(() => expect(screen.queryByLabelText('选择流水 12')).not.toBeInTheDocument());
  expect(screen.getByLabelText('全选待分类流水')).not.toBeChecked();
  expect(screen.getByText('已选 0 条 · 0.00 元')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('流水 13 分类'),{target:{value:'refund'}});
  fireEvent.click(screen.getByRole('button',{name:'核对到账'}));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/meal-tickets/reconcile',expect.objectContaining({body:expect.objectContaining({refund_actions:{13:'refund'}})})));
});

it('月度核对期间切换月份，旧响应不会覆盖新月份真实状态', async () => {
  let finish!: (value: unknown) => void;
  const delayed = new Promise(resolve => { finish = resolve; });
  const next = {...batch,id:2,month:'2026-09',recharge_month:'2026-10',status:'draft',items:[{...item,name:'十月员工'}]};
  request.mockImplementation((path:string) => path === '/api/auth/me' ? Promise.resolve({role:'admin'})
    : path === '/api/meal-tickets/reconcile' ? delayed
    : Promise.resolve(path.includes('recharge_month=2026-10') ? next : batch));
  function Navigation() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/meal-tickets/calculation?recharge_month=2026-10')}>换到十月</button>;
  }
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/calculation?recharge_month=2026-09']}><Navigation/><MealTicketPage/></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'已完成充值，核对到账'}));
  fireEvent.click(screen.getByRole('button',{name:'换到十月'}));
  expect(screen.getByLabelText('计划充值月份')).toHaveValue('2026-09');
  await act(async () => { finish({...batch,items:[{...item,paid_amount:176,difference:0}]}); await delayed; });
  await screen.findByText('十月员工');
  expect(screen.getByText('十月员工')).toBeInTheDocument();
  expect(screen.getByLabelText('计划充值月份')).toHaveValue('2026-10');
  expect(screen.getByRole('list',{name:'月度发放流程'}).querySelector('[aria-current="step"]')).toHaveTextContent('计算与核对');
  expect(screen.queryByRole('link',{name:'导出充值表（.xls）'})).not.toBeInTheDocument();
});

it('已有部分实际到账恢复核对阶段，不因没有下载记录退回充值阶段', async () => {
  request.mockImplementation((path:string) => Promise.resolve(path === '/api/auth/me' ? {role:'admin'}
    : {...batch,items:[{...item,paid_amount:160,difference:16}]}));
  page();
  await screen.findByText('员工甲');
  expect(screen.getByRole('list',{name:'月度发放流程'}).querySelector('[aria-current="step"]')).toHaveTextContent('核对到账');
  expect(screen.getAllByRole('button',{name:'核对到账'})).toHaveLength(1);
});

it('后续核对失败保留原金额和待核对任务，延迟流水不自动提示再次充值', async () => {
  const current = { ...batch, version: 3, items: [{ ...item, due_amount: 200, paid_amount: 176, difference: 24 }] };
  const state = { batch_id: 1, batch_version: 3, offset_enabled: true, settings_digest: "s", queue_offset_enabled: true,
    settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: null,
    tasks: [{ key: "waiting", item_key: "i", emp_no: "001", name: "员工甲", dept_name: "生产部", kind: "recharge",
      amount_cents: 2400, allocated_cents: 0, remaining_cents: 2400, status: "awaiting", version: 2,
      operation_at: "2026-09-02T00:00:00", offset_enabled: true, settings_digest: "s" }] };
  request.mockImplementation((path: string) => path.endsWith('/reconcile') ? Promise.reject(new Error('共享数据库读取失败'))
    : Promise.resolve(path === '/api/auth/me' ? { role: 'admin' } : path.includes('followup-tasks') ? state : current));
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments" /></MemoryRouter></ConfirmProvider>);
  await waitFor(() => expect(screen.getByRole('region', { name: '待核对任务' })).toHaveTextContent('剩余 24.00 元'));
  fireEvent.click(screen.getByRole('button', { name: '核对结果' }));
  await screen.findByText('共享数据库读取失败');
  expect(screen.getByRole('region', { name: '待核对任务' })).toHaveTextContent('已匹配 0.00 元 · 剩余 24.00 元');
  expect(screen.queryByRole('button', { name: '已完成充值，下一人' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '登记实际充值 · 001' })).not.toBeInTheDocument();
  const row = screen.getByRole('region', { name: '人员明细' }).querySelector('tbody tr')!;
  expect(row).toHaveTextContent('176.00');
  expect(request.mock.calls.some(([path]) => path.endsWith('/progress') || path.endsWith('/payments'))).toBe(false);
});

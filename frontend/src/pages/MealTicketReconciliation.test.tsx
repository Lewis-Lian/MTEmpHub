import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import MealTicketPage from './MealTicketPage';
import { ConfirmProvider } from '../components/feedback/ConfirmDialog';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../api/client',()=>({apiRequest:request,buildApiUrl:(p:string)=>p}));
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
  expect(screen.getByRole('list',{name:'月度发放流程'}).querySelector('[aria-current="step"]')).toHaveTextContent('补扣与确认核算');
  expect(screen.getByRole('region',{name:'整月结清检查'})).toHaveTextContent('草稿待核算');
  expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('核对开始日期')).not.toBeInTheDocument();
});
it('已确认月度发放不再提示源数据变化', async () => {
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:{...batch,source_changed:true}));
  page();
  await screen.findByText('员工甲');
  expect(screen.queryByText(/源考勤或人员资料已变化/)).not.toBeInTheDocument();
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
function page() {
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/calculation?recharge_month=2026-09']}><MealTicketPage/></MemoryRouter></ConfirmProvider>);
}
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
  fireEvent.click(screen.getByRole('button', { name: '确认分类并重新核对' }));
  expect(await screen.findByText('本月账目已结清')).toBeInTheDocument();
});
it('数据库核对按选定日期更新结清，展示三类实际流水及重复记录数',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    path==='/api/meal-tickets/reconcile'?{...batch,version:3,items:[{...item,paid_amount:176,difference:0}],
      reconciliation:{checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-10-06',added:3,existing:2,unmatched:1,zero_amount:1,outside_subsidy_month:0,sources:{subsidy:1,recharge:1,refund:1}}}:batch));
  page();
  const panel=await screen.findByRole('region',{name:'到账核对'});
  expect(screen.queryByRole('button',{name:'登记充值'})).not.toBeInTheDocument();
  fireEvent.change(within(panel).getByLabelText('核对结束日期'),{target:{value:'2026-10-06'}});
  fireEvent.click(within(panel).getByRole('button',{name:'读取数据库并核对'}));
  expect(await screen.findByText('本月账目已结清')).toBeInTheDocument();
  expect(within(panel).getByText('新增 3 条 · 已登记 2 条')).toBeInTheDocument();
  expect(within(panel).getByText(/未匹配本月人员 1 条/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/reconcile',expect.objectContaining({method:'POST',body:{batch_id:1,version:2,start_date:'2026-09-01',end_date:'2026-10-06'}}));
});
it('数据库读取失败保留待发账目并显示错误',async()=>{
  request.mockImplementation((path:string)=>path==='/api/auth/me'?Promise.resolve({role:'admin'}):
    path==='/api/meal-tickets/reconcile'?Promise.reject(new Error('共享数据库读取失败')):Promise.resolve(batch));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  fireEvent.click(within(screen.getByRole('region',{name:'到账核对'})).getByRole('button',{name:'读取数据库并核对'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('共享数据库读取失败');
  expect(within(panel).getByText('数据库核对未完成')).toBeInTheDocument();
});
it('只读账号查看到账结果，不发起数据库入账',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'readonly'}:batch));
  page();
  await screen.findByText('员工甲');
  expect(screen.queryByRole('button',{name:'读取数据库并核对'})).not.toBeInTheDocument();
});
it('已由数据库登记的账目关闭开关后显示暂停，不开放手工重复登记',async()=>{
  const current={...batch,database:{enabled:false,configured:true},items:[{...item,paid_amount:160,difference:16,
    payments:[{id:1,kind:'recharge',amount:160,date:'2026-09-04',reference:'数据库补贴发放',operator:'admin',reversed:false,database_record:true}]}]};
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:current));
  page();
  await screen.findByText('员工甲');
  expect(screen.queryByRole('button',{name:'登记充值'})).not.toBeInTheDocument();
  expect(screen.getByText('数据库核对已暂停')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'读取数据库并核对'})).toBeDisabled();
});
it('原账结清但本次数据库读取失败时不显示本次核对成功',async()=>{
  request.mockImplementation((path:string)=>path==='/api/auth/me'?Promise.resolve({role:'admin'}):
    path==='/api/meal-tickets/reconcile'?Promise.reject(new Error('已登记流水发生变化')):
    Promise.resolve({...batch,items:[{...item,paid_amount:176,difference:0}]}));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  expect(within(panel).queryByLabelText('核对开始日期')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region',{name:'到账核对'})).getByRole('button',{name:'读取数据库并核对'}));
  await screen.findByRole('alert');
  expect(within(panel).queryByText('本月账目已结清')).not.toBeInTheDocument();
  expect(within(panel).getByText('数据库核对未完成')).toBeInTheDocument();
});

it('数据库模式合并到账与结清步骤，后续补扣也直接核对',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:batch));
  page();
  await screen.findByText('员工甲');
  const flow=screen.getByRole('list',{name:'月度发放流程'});
  expect(within(flow).getAllByRole('listitem').map(step=>within(step).getByRole('heading').textContent))
    .toEqual(['生成草稿','补扣与确认核算','导出充值表','核对到账与结清']);
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('核对到账与结清');
  expect(within(flow).getByRole('button',{name:'核对到账与结清'})).toBeEnabled();
});

it('数据库模式后续补扣仅保留调整和到账结清两个步骤',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:batch));
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByText('员工甲');
  const flow=screen.getByRole('list',{name:'后续补扣流程'});
  expect(within(flow).getAllByRole('listitem').map(step=>within(step).getByRole('heading').textContent))
    .toEqual(['补发 / 扣除','核对到账与结清']);
});

it.each([false,true])('后续补扣进入页面先调整，结清状态为 %s 也不跳过',async settled=>{
  const current={...batch,items:[{...item,paid_amount:settled?176:0,difference:settled?0:176}]};
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:current));
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByText('员工甲');
  const flow=screen.getByRole('list',{name:'后续补扣流程'});
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('补发 / 扣除');
  expect(screen.queryByRole('region',{name:'整月结清检查'})).not.toBeInTheDocument();
  fireEvent.click(within(flow).getByRole('button',{name:'下一步：核对到账与结清'}));
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('核对到账与结清');
  expect(screen.getByRole('region',{name:'整月结清检查'})).toBeInTheDocument();
  expect(screen.getByRole('region',{name:'到账核对'})).toBeInTheDocument();
  expect(request.mock.calls.some(([path])=>path==='/api/meal-tickets/reconcile')).toBe(false);
  fireEvent.click(within(flow).getByRole('button',{name:'返回补发 / 扣除'}));
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('补发 / 扣除');
  expect(screen.queryByRole('region',{name:'整月结清检查'})).not.toBeInTheDocument();
  expect(screen.queryByRole('region',{name:'到账核对'})).not.toBeInTheDocument();
});

it('后续补扣保存成功仍停留调整阶段，切换月份重新从第一步开始',async()=>{
  let current={...batch,items:[{...item,paid_amount:176,difference:0}]};
  request.mockImplementation((path:string)=>{
    if(path==='/api/auth/me')return Promise.resolve({role:'admin'});
    if(path==='/api/meal-tickets/adjustments')current={...current,version:3,items:[{...current.items[0],adjustment_amount:16,due_amount:192,difference:16}]};
    return Promise.resolve(current);
  });
  render(<ConfirmProvider><MemoryRouter initialEntries={["/meal-tickets/payments?recharge_month=2026-09"]}><MealTicketPage view="payments"/></MemoryRouter></ConfirmProvider>);
  await screen.findByText('员工甲');
  fireEvent.click(screen.getByRole('button',{name:'补扣'}));
  fireEvent.change(screen.getByLabelText('调整金额（元）'),{target:{value:'16'}});
  fireEvent.click(screen.getByRole('button',{name:'线长补卡'}));
  fireEvent.click(screen.getByRole('button',{name:'保存补扣'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'额外补扣'})).not.toBeInTheDocument());
  const flow=screen.getByRole('list',{name:'后续补扣流程'});
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('补发 / 扣除');
  expect(screen.queryByRole('region',{name:'整月结清检查'})).not.toBeInTheDocument();
  fireEvent.click(within(flow).getByRole('button',{name:'下一步：核对到账与结清'}));
  fireEvent.change(screen.getByLabelText('计划充值月份'),{target:{value:'2026-10'}});
  await screen.findByText('员工甲');
  expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent('补发 / 扣除');
});

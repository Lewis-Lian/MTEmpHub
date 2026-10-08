import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
function page() {
  render(<ConfirmProvider><MemoryRouter initialEntries={['/meal-tickets/calculation?recharge_month=2026-09']}><MealTicketPage/></MemoryRouter></ConfirmProvider>);
}
it('数据库核对按选定日期更新结清，展示三类实际流水及重复记录数',async()=>{
  request.mockImplementation((path:string)=>Promise.resolve(path==='/api/auth/me'?{role:'admin'}:
    path==='/api/meal-tickets/reconcile'?{...batch,version:3,items:[{...item,paid_amount:176,difference:0}],
      reconciliation:{checked_at:'2026-10-08T16:00:00',start_date:'2026-09-01',end_date:'2026-10-06',added:3,existing:2,unmatched:1,zero_amount:1,outside_subsidy_month:0,sources:{subsidy:1,recharge:1,refund:1}}}:batch));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  expect(screen.queryByRole('button',{name:'登记充值'})).not.toBeInTheDocument();
  fireEvent.change(within(panel).getByLabelText('核对结束日期'),{target:{value:'2026-10-06'}});
  fireEvent.click(within(panel).getByRole('button',{name:'读取数据库并核对'}));
  expect(await within(panel).findByText('本月账目已结清')).toBeInTheDocument();
  expect(within(panel).getByText('新增 3 条 · 已登记 2 条')).toBeInTheDocument();
  expect(within(panel).getByText(/未匹配本月人员 1 条/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/reconcile',expect.objectContaining({method:'POST',body:{batch_id:1,version:2,start_date:'2026-09-01',end_date:'2026-10-06'}}));
});
it('数据库读取失败保留待发账目并显示错误',async()=>{
  request.mockImplementation((path:string)=>path==='/api/auth/me'?Promise.resolve({role:'admin'}):
    path==='/api/meal-tickets/reconcile'?Promise.reject(new Error('共享数据库读取失败')):Promise.resolve(batch));
  page();
  const panel=await screen.findByRole('region',{name:'整月结清检查'});
  fireEvent.click(within(panel).getByRole('button',{name:'读取数据库并核对'}));
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
  fireEvent.click(within(panel).getByRole('button',{name:'读取数据库并核对'}));
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
    .toEqual(['生成草稿','补发 / 扣除','确认核算','导出充值表','核对到账与结清']);
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

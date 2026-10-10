import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MealTicketPage from './MealTicketPage';
import { ConfirmProvider } from '../components/feedback/ConfirmDialog';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ apiRequest: async (path: string, options?: object) => {
  const result = await request(path, options);
  if (path.includes("followup-tasks") && !Array.isArray(result?.tasks)) return {
    batch_id: result?.id ?? 1, batch_version: result?.version ?? 1, offset_enabled: true, settings_digest: "s",
    queue_offset_enabled: true, settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: null, tasks: [],
  };
  return result;
}, buildApiUrl: (path: string) => path }));
const person = { id: 1, emp_id: 1, emp_no: '001', name: '员工甲', dept_name: '生产部', is_manager: false,
  days: 22, base_amount: 176, adjustment_amount: 0, due_amount: 176, paid_amount: 0, difference: 176,
  error: '', source: {}, employment_status: 'active', resigned_at: null, excluded: false,
  original_base_amount: 176, participation_history: [], adjustments: [], payments: [] };
const batch = { id: 1, month: '2026-08', recharge_month: '2026-09', status: 'confirmed', version: 1,
  source_changed: false, database: { enabled: false, configured: false }, departments: [],
  items: [person, { ...person, id: 2, emp_id: 2, emp_no: '002', name: '员工乙' }] };

beforeEach(() => {
  request.mockReset(); sessionStorage.clear();
  // HTTP 浏览器仍提供 getRandomValues，但不提供 randomUUID。
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
});
afterEach(() => vi.unstubAllGlobals());

it('缺少 randomUUID 时多选登记能提交，失败重试复用每人原标识', async () => {
  let current = batch;
  let failed = false;
  const submitted: Array<{ item_id: number; request_key: string }> = [];
  request.mockImplementation((path: string, options?: { body: { item_id: number; request_key: string } }) => {
    if (path === '/api/auth/me') return Promise.resolve({ role: 'admin' });
    if (path === '/api/meal-tickets/payments') {
      const body = options!.body;
      submitted.push(body);
      if (body.item_id === 2 && !failed) { failed = true; return Promise.reject(new Error('请重试')); }
      current = { ...current, version: current.version + 1,
        items: current.items.map(item => item.id === body.item_id ? { ...item, paid_amount: 176, difference: 0 } : item) };
    }
    return Promise.resolve(current);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage /></MemoryRouter></ConfirmProvider>);
  await screen.findByText('员工乙');
  fireEvent.click(screen.getByLabelText('全选筛选结果'));
  fireEvent.click(screen.getByRole('button', { name: '登记选中人员充值' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('凭证 / 说明'), { target: { value: '实际充值成功' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认登记' }));
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent === '请重试')).toBe(true));
  fireEvent.click(dialog.getByRole('button', { name: '确认登记' }));
  expect(await screen.findByText('本月账目已结清')).toBeInTheDocument();
  expect(submitted.map(body => body.item_id)).toEqual([1, 2, 2]);
  expect(submitted[0].request_key.length).toBeGreaterThan(0);
  expect(submitted[0].request_key.length).toBeLessThanOrEqual(100);
  expect(submitted[1].request_key).not.toBe(submitted[0].request_key);
  expect(submitted[2].request_key).toBe(submitted[1].request_key);
});

it('缺少 randomUUID 时单人登记仍能打开并完成', async () => {
  const current = { ...batch, items: [person] };
  request.mockImplementation((path: string, options?: { body: { request_key?: string } }) => {
    if (path === '/api/meal-tickets/payments' && !options?.body.request_key) return Promise.reject(new Error('请求标识不能为空'));
    return Promise.resolve(path === '/api/auth/me' ? { role: 'admin' }
      : path === '/api/meal-tickets/payments' ? { ...current, version: 2, items: [{ ...person, paid_amount: 176, difference: 0 }] } : current);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage /></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '登记充值' }));
  expect(within(screen.getByRole('list',{name:'月度发放流程'})).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'重新核对'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'登记实际充值'})).not.toBeInTheDocument();
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('凭证 / 说明'), { target: { value: '实际充值成功' } });
  fireEvent.change(dialog.getByLabelText('实际日期'), { target: { value: '2026-09-04' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认登记' }));
  expect(await screen.findByText('本月账目已结清')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/payments',expect.objectContaining({body:expect.objectContaining({item_id:1,amount:'176.00',date:'2026-09-04',reference:'实际充值成功'})}));
  expect(screen.getAllByRole('link',{name:'导出充值表（.xls）'})).toHaveLength(1);
  expect(screen.getByRole('region',{name:'人员明细'})).not.toBeVisible();
});

it('关闭抵消通过任务入口登记真实充值40，发送任务版本并刷新结果', async () => {
  const current = { ...batch, database: { enabled: false, configured: false }, version: 3,
    items: [{ ...person, paid_amount: 176, due_amount: 200, difference: 24 }] };
  const task = { key: "charge40", item_key: "i", emp_no: person.emp_no, name: person.name, dept_name: person.dept_name,
    kind: "recharge", amount_cents: 4000, allocated_cents: 0, remaining_cents: 4000, status: "awaiting", version: 2,
    operation_at: "2026-09-02T00:00:00", offset_enabled: false, settings_digest: "s" };
  let state = { batch_id: 1, batch_version: 3, offset_enabled: false, settings_digest: "s", queue_offset_enabled: false,
    settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: null, tasks: [task] };
  let ledger = current;
  request.mockImplementation((path: string) => {
    if (path === '/api/auth/me') return Promise.resolve({ role: 'admin' });
    if (path.includes('followup-tasks')) return Promise.resolve(state);
    if (path === '/api/meal-tickets/payments') {
      state = { ...state, batch_version: 4, tasks: [{ ...task, status: "verified", allocated_cents: 4000, remaining_cents: 0 }] };
      ledger = { ...current, version: 4, items: [{ ...current.items[0], paid_amount: 216, difference: -16 }] };
    }
    return Promise.resolve(ledger);
  });
  render(<ConfirmProvider><MemoryRouter><MealTicketPage view="payments" /></MemoryRouter></ConfirmProvider>);
  fireEvent.click(await screen.findByRole('button', { name: `登记实际充值 · ${person.emp_no}` }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByLabelText('金额（元）')).toHaveValue(40);
  fireEvent.change(dialog.getByLabelText('凭证 / 说明'), { target: { value: '设备真实充值40' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认登记' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(request).toHaveBeenCalledWith('/api/meal-tickets/payments', expect.objectContaining({ body: expect.objectContaining({
    task_key: 'charge40', task_version: 2, kind: 'recharge', amount: '40.00', item_id: 1 }) }));
  await screen.findByText(/已核对 1 项/);
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import MealTicketPage from "./MealTicketPage";
import { ConfirmProvider } from "../components/feedback/ConfirmDialog";
import MealFundsAudit from "../components/meal/MealFundsAudit";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
const item = { id:1, emp_id:1, emp_no:"001", name:"员工甲", dept_name:"生产部", is_manager:false,
  days:22, base_amount:176, adjustment_amount:0, due_amount:176, paid_amount:176, difference:0,
  error:"", source:{}, employment_status:"active", resigned_at:null, excluded:false, original_base_amount:176,
  participation_history:[], adjustments:[], payments:[] };
const batch = { id:1, month:"2026-08", recharge_month:"2026-09", status:"confirmed", version:2,
  source_changed:false, database:{enabled:true, configured:true}, items:[item], departments:[] };
const clear = { start_date:"2026-09-01", end_date:"2026-09-30", checked_at:"2026-09-30T12:00:00",
  complete:true, database_net_cents:17600, recorded_net_cents:17600,
  sources:[{ source:"subsidy", database_count:1, database_cents:17600, recorded_count:1, recorded_cents:17600,
    employee_cents:17600, guest_cents:0, clearance_cents:0 }], issues:[] };
const extra = { ...clear, complete:false, database_net_cents:20100,
  sources:[...clear.sources, { source:"recharge", database_count:1, database_cents:2500, recorded_count:0,
    recorded_cents:0, employee_cents:0, guest_cents:0, clearance_cents:0 }],
  issues:[{ source_key:"card-meal:test:recharge:20", source:"recharge", status:"unassigned", date:"2026-09-20",
    emp_no:"UNKNOWN", amount_cents:2500, recorded_cents:0, owners:[] }] };

beforeEach(() => {
  request.mockReset(); sessionStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn();
  request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? {role:"admin"}
    : path.includes("followup-tasks") ? {batch_id:1, batch_version:2, baseline_required:false, tasks:[]}
    : path === "/api/meal-tickets/funds-audit" ? extra : batch));
});
function page() {
  return render(<ConfirmProvider><MemoryRouter initialEntries={["/meal-tickets/payments?recharge_month=2026-09"]}>
    <MealTicketPage view="payments" /></MemoryRouter></ConfirmProvider>);
}

async function openAudit() {
  const trigger = await screen.findByRole("button", {name:"核对全部资金"});
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole("dialog", {name:"全部资金核对"});
}

it("步骤卡片内显示核对按钮，弹窗关闭后不占用页面下方空间并返回焦点", async () => {
  page();
  const trigger = await screen.findByRole("button", {name:"核对全部资金"});
  expect(trigger.closest(".meal-ticket-flow")).not.toBeNull();
  expect(screen.queryByRole("dialog", {name:"全部资金核对"})).not.toBeInTheDocument();
  expect(screen.queryByRole("region", {name:"全部资金核对"})).not.toBeInTheDocument();
  expect(screen.queryByLabelText("资金核对开始日期")).not.toBeInTheDocument();
  const panel = await openAudit();
  expect(panel).toHaveAttribute("aria-modal", "true");
  expect(within(panel).getByLabelText("资金核对开始日期")).toHaveFocus();
  fireEvent.click(within(panel).getByRole("button", {name:"关闭"}));
  expect(screen.queryByRole("dialog", {name:"全部资金核对"})).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/funds-audit")).toBe(false);
});

it("员工结清后仍可核对全部资金，名单外充值展示明细且不冒充全部核清", async () => {
  page();
  const panel = await openAudit();
  expect(within(panel).getByText("全部资金待核对")).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  expect(await within(panel).findByText("存在待归属或异常流水")).toBeInTheDocument();
  expect(within(panel).getByText("UNKNOWN")).toBeInTheDocument();
  expect(within(panel).getByRole("table", {name:"资金分类汇总"})).toHaveTextContent("25.00");
  expect(within(panel).queryByText("全部资金已核清")).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/api/meal-tickets/funds-audit", expect.objectContaining({method:"POST",
    body:{start_date:"2026-09-01", end_date:"2026-09-30"}}));
  expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/reconcile")).toBe(false);
});

it("核清后再次查询会发现新增流水，查询失败不保留旧的成功状态", async () => {
  request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? {role:"admin"}
    : path.includes("followup-tasks") ? {batch_id:1, batch_version:2, baseline_required:false, tasks:[]}
    : path === "/api/meal-tickets/funds-audit" ? clear : batch));
  page();
  const panel = await openAudit();
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await within(panel).findByText("全部资金已核清");
  request.mockImplementation((path: string) => path === "/api/meal-tickets/funds-audit"
    ? Promise.reject(new Error("数据库不可用")) : Promise.resolve(batch));
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await within(panel).findByText("数据库不可用");
  expect(within(panel).queryByText("全部资金已核清")).not.toBeInTheDocument();
  request.mockResolvedValue(extra);
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await within(panel).findByText("UNKNOWN");
});

it("调整范围后清除旧核清结果，并忽略旧范围的延迟响应", async () => {
  page();
  const panel = await openAudit();
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.change(within(panel).getByLabelText("资金核对结束日期"), {target:{value:"2026-10-02"}});
  await act(async () => { finish(clear); });
  expect(within(panel).queryByText("全部资金已核清")).not.toBeInTheDocument();
  expect(within(panel).getByText("全部资金待核对")).toBeInTheDocument();
});

it("没有员工核算批次仍能核对名单外资金", async () => {
  request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? {role:"admin"}
    : path === "/api/meal-tickets/funds-audit" ? extra : null));
  page();
  const panel = await openAudit();
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await within(panel).findByText("UNKNOWN");
});

it("本地账目更新后清除先前的核清结论", async () => {
  request.mockResolvedValue(clear);
  const view = render(<MemoryRouter><MealFundsAudit month="2026-09" revision="2" disabled={false} /></MemoryRouter>);
  const panel = await openAudit();
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await screen.findByText("全部资金已核清");
  view.rerender(<MemoryRouter><MealFundsAudit month="2026-09" revision="3" disabled={false} /></MemoryRouter>);
  expect(screen.queryByText("全部资金已核清")).not.toBeInTheDocument();
  expect(screen.getByText("全部资金待核对")).toBeInTheDocument();
});

it("查询账号不展示全库资金及名单外人员入口", async () => {
  request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? {role:"readonly"} : batch));
  page();
  await screen.findByText("员工账目已结清");
  expect(screen.queryByRole("region", {name:"全部资金核对"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name:"核对全部资金"})).not.toBeInTheDocument();
});

it("查询期间可按 Esc 关闭，重新打开不接收旧弹窗的迟到结果", async () => {
  page();
  const panel = await openAudit();
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(within(panel).getByRole("button", {name:"开始核对"}));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.keyDown(document, {key:"Escape"});
  expect(screen.queryByRole("dialog", {name:"全部资金核对"})).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name:"核对全部资金"})).toHaveFocus();
  const reopened = await openAudit();
  await act(async () => { finish(clear); });
  expect(within(reopened).getByText("全部资金待核对")).toBeInTheDocument();
  expect(within(reopened).queryByText("全部资金已核清")).not.toBeInTheDocument();
});

it("弹窗键盘焦点在内部循环，关闭后恢复页面滚动", async () => {
  page();
  const overflow = document.body.style.overflow;
  const panel = await openAudit();
  expect(document.body.style.overflow).toBe("hidden");
  const close = within(panel).getByRole("button", {name:"关闭"});
  const check = within(panel).getByRole("button", {name:"开始核对"});
  close.focus();
  fireEvent.keyDown(close, {key:"Tab", shiftKey:true});
  expect(check).toHaveFocus();
  fireEvent.keyDown(check, {key:"Tab"});
  expect(close).toHaveFocus();
  fireEvent.click(check);
  const link = await within(panel).findByRole("link", {name:"月末清零"});
  link.focus();
  fireEvent.keyDown(link, {key:"Tab"});
  expect(close).toHaveFocus();
  fireEvent.click(close);
  expect(document.body.style.overflow).toBe(overflow);
});

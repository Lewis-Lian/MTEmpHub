import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import MealTicketPage from "./MealTicketPage";
import { ConfirmProvider } from "../components/feedback/ConfirmDialog";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
const person = { id: 1, emp_id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", is_manager: false,
  days: 22, base_amount: 176, original_base_amount: 176, adjustment_amount: 0, due_amount: 176,
  paid_amount: 176, difference: 0, error: "", source: {}, excluded: false, employment_status: "active",
  resigned_at: null, participation_history: [], adjustments: [], payments: [] };
const batch = { id: 1, month: "2026-08", recharge_month: "2026-09", status: "confirmed", version: 3,
  source_changed: false, database: { enabled: true, configured: true }, items: [person], departments: [] };
const task = { key: "charge", item_key: "i", emp_no: "001", name: "员工甲", dept_name: "生产部", kind: "recharge",
  amount_cents: 2400, allocated_cents: 0, remaining_cents: 2400, status: "pending", version: 1,
  operation_at: null, offset_enabled: true, settings_digest: "s" };
const queue = { batch_id: 1, batch_version: 3, offset_enabled: true, settings_digest: "s", queue_offset_enabled: true,
  settings_changed: false, baseline_required: false, baseline_items: [], baseline_reason: "", current_task_key: null, tasks: [] };
beforeEach(() => { request.mockReset(); sessionStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
function page() {
  render(<ConfirmProvider><MemoryRouter initialEntries={["/meal-tickets/payments?recharge_month=2026-09"]}>
    <MealTicketPage view="payments" />
  </MemoryRouter></ConfirmProvider>);
}
it("登记后下一步才显示办理，完成后才显示对账，并能返回登记", async () => {
  let ledger = batch;
  let state: Omit<typeof queue, "tasks" | "current_task_key"> & { tasks: typeof task[]; current_task_key: string | null } = queue;
  request.mockImplementation(async (path: string) => {
    if (path === "/api/auth/me") return { role: "admin" };
    if (path === "/api/meal-tickets/adjustments") {
      ledger = { ...ledger, version: 4, items: [{ ...person, adjustment_amount: 24, due_amount: 200, difference: 24 }] };
      state = { ...state, batch_version: 4 };
    }
    if (path.endsWith("/refresh")) state = { ...state, current_task_key: task.key, tasks: [task] };
    if (path.endsWith("/progress")) {
      ledger = { ...ledger, version: 5 };
      state = { ...state, batch_version: 5, current_task_key: null, tasks: [{ ...task, status: "awaiting" }] };
    }
    return path.includes("followup-tasks") ? state : ledger;
  });
  page();
  await screen.findByRole("button", { name: "导入补扣清单" });
  expect(screen.queryByRole("region", { name: "当前办理任务" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "待核对任务" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "到账核对" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("显示全部人员"));
  fireEvent.click(screen.getByRole("button", { name: "补扣" }));
  fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "24" } });
  fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "补发" } });
  fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一步：逐人办理" })).toBeEnabled());
  expect(screen.queryByRole("region", { name: "当前办理任务" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下一步：逐人办理" }));
  await screen.findByRole("region", { name: "当前办理任务" });
  expect(screen.queryByRole("button", { name: "导入补扣清单" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "实际流水核对" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "到账核对" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "已完成充值，下一人" }));
  await screen.findByRole("region", { name: "待核对任务" });
  expect(screen.getByRole("region", { name: "到账核对" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "当前办理任务" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回登记补扣" }));
  await screen.findByRole("button", { name: "导入补扣清单" });
  expect(screen.queryByRole("region", { name: "到账核对" })).not.toBeInTheDocument();
});
it.each(["pending", "awaiting"])("重新进入页面恢复 %s 对应步骤", async status => {
  request.mockImplementation(async (path: string) => path === "/api/auth/me" ? { role: "admin" }
    : path.includes("followup-tasks") ? { ...queue, tasks: [{ ...task, status }] }
    : { ...batch, items: [{ ...person, due_amount: 200, difference: 24 }] });
  page();
  const flow = await screen.findByRole("list", { name: "后续补扣流程" });
  await waitFor(() => expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent(status === "pending" ? "逐人办理" : "核对结果"));
  expect(screen.queryByRole("button", { name: "导入补扣清单" })).not.toBeInTheDocument();
  if (status === "pending") {
    expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("24.00");
    expect(screen.queryByRole("region", { name: "到账核对" })).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole("region", { name: "待核对任务" })).toHaveTextContent("员工甲");
    expect(screen.getByRole("region", { name: "到账核对" })).toBeInTheDocument();
  }
});

it("切换月份后清除手动返回状态，按新月份任务恢复步骤", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/api/auth/me") return { role: "admin" };
    const october = path.includes("recharge_month=2026-10");
    if (path.includes("followup-tasks")) return { ...queue, batch_id: october ? 2 : 1,
      tasks: [{ ...task, status: october ? "awaiting" : "pending" }] };
    return { ...batch, id: october ? 2 : 1, recharge_month: october ? "2026-10" : "2026-09",
      month: october ? "2026-09" : "2026-08", items: [{ ...person, due_amount: 200, difference: 24 }] };
  });
  render(<ConfirmProvider><MemoryRouter initialEntries={["/meal-tickets/payments?recharge_month=2026-09"]}>
    <Link to="/meal-tickets/payments?recharge_month=2026-10">换到十月</Link><MealTicketPage view="payments" />
  </MemoryRouter></ConfirmProvider>);
  await screen.findByRole("button", { name: "已完成充值，下一人" });
  fireEvent.click(screen.getByRole("button", { name: "返回登记补扣" }));
  await screen.findByRole("button", { name: "导入补扣清单" });
  fireEvent.click(screen.getByRole("link", { name: "换到十月" }));
  await screen.findByRole("region", { name: "待核对任务" });
  expect(screen.queryByRole("button", { name: "导入补扣清单" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "当前办理任务" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "到账核对" })).toBeInTheDocument();
});

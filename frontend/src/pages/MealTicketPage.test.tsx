import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import MealTicketPage from "./MealTicketPage";

const batch = { id: 1, month: "2026-08", recharge_month: "2026-09", version: 1, status: "draft", source_changed: false,
  departments: [{ dept_name: "生产部", count: 1, due_amount: 176, base_amount: 176, adjustment_amount: 0, paid_amount: 0, difference: 176 }],
  items: [{ id: 1, emp_id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", days: 22, base_amount: 176,
    adjustment_amount: 0, due_amount: 176, paid_amount: 0, difference: 176, error: "", source: {}, adjustments: [], payments: [] }] };
const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (p: string) => p }));

describe("菜票中心", () => {
  beforeEach(() => { sessionStorage.clear(); request.mockClear(); });
  it("显示考勤与充值月份，提交带版本的补扣", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation"]}><MealTicketPage /></MemoryRouter>);
    expect(await screen.findByText("员工甲")).toBeInTheDocument();
    expect(screen.getByText(/考勤月份：2026-08/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补扣" }));
    fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "特殊补发" } });
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets/adjustments", expect.objectContaining({
      body: expect.objectContaining({ batch_id: 1, version: 1, item_id: 1, amount: "16", reason: "特殊补发" }),
    })));
  });

  it("查询账号不显示核算或补扣操作", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "readonly" } : batch));
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation"]}><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    expect(screen.queryByRole("button", { name: "生成 / 重算草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补扣" })).not.toBeInTheDocument();
  });

  it("状态排序将跨页的核算问题排到前面，再次点击反向排序", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...batch.items[0],
      id: index + 1, emp_no: String(index + 1), name: `已结清${index + 1}`, paid_amount: 176, difference: 0 }));
    items.push(
      { ...batch.items[0], id: 101, name: "部分发放人员", paid_amount: 80, difference: 96 },
      { ...batch.items[0], id: 102, name: "未发人员" },
      { ...batch.items[0], id: 103, name: "待扣回人员", paid_amount: 180, difference: -4 },
      { ...batch.items[0], id: 104, name: "负数应发人员", adjustment_amount: -180, due_amount: -4, difference: -4 },
      { ...batch.items[0], id: 105, name: "考勤异常人员", error: "缺少考勤来源，请核对" },
    );
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : { ...batch, items }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("已结清1");
    expect(screen.queryByText("考勤异常人员")).not.toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "人员明细" })).getByRole("table");
    const names = () => within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[1].textContent);
    const sort = within(table).getByRole("button", { name: /状态 \/ 操作/ });
    fireEvent.click(sort);
    expect(names().slice(0, 5)).toEqual(["负数应发人员", "考勤异常人员", "待扣回人员", "未发人员", "部分发放人员"]);
    fireEvent.click(within(within(table).getAllByRole("row")[1]).getByRole("button", { name: "明细" }));
    expect(within(screen.getByRole("dialog", { name: "菜票明细" })).getByRole("heading", { name: /负数应发人员/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(sort);
    expect(names()[0]).toBe("已结清1");
  });

  it("缓存页面保持独立模式，重挂载保留所选月份", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    const first = render(<MemoryRouter initialEntries={["/meal-tickets/history"]}><MealTicketPage view="payments" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "菜票充值与对账" })).toBeInTheDocument();
    await screen.findByText("员工甲");
    fireEvent.change(screen.getByLabelText("计划充值月份"), { target: { value: "2026-09" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets?recharge_month=2026-09"));
    first.unmount();
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    expect(screen.getByLabelText("计划充值月份")).toHaveValue("2026-09");
    await screen.findByText("员工甲");
  });

  it("历史原账按需读取试算，分别展示金额且不登记充值", async () => {
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "confirmed",
      rows: [], person_total: 180, department_total: 180, departments: [] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : path === "/api/admin/employees?status=all" ? []
      : path.endsWith("/comparison") ? [{ id: 1, emp_no: "001", name: "员工甲", historical_amount: 180, days: 22, base_amount: 176, difference: 4, error: "" }]
      : [history]));
    render(<MealTicketPage view="history" />);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(screen.getByRole("button", { name: "读取考勤试算对比" }));
    await screen.findByText("员工甲");
    expect(screen.getByText("176.00")).toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
  });
});

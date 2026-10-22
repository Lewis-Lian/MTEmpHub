import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/feedback/ConfirmDialog";
import type { MealBatch, MealItem } from "../../api/mealTickets";
import MealTicketQueryPage from "./MealTicketQueryPage";

const employees = [
  { id: 1, emp_no: "E001", name: "张三", dept_id: 1, dept_name: "历史一部", is_manager: false },
  { id: 2, emp_no: "E002", name: "李四", dept_id: 2, dept_name: "历史二部", is_manager: true },
];
const options = {
  employees,
  departments: [
    { id: 1, dept_name: "历史一部", dept_no: "", parent_id: null },
    { id: 2, dept_name: "历史二部", dept_no: "", parent_id: null },
  ],
};
const items: MealItem[] = employees.map(employee => ({
  id: employee.id, emp_id: employee.id, emp_no: employee.emp_no, name: employee.name,
  dept_name: employee.dept_name, is_manager: employee.is_manager, days: 20,
  base_amount: 160, adjustment_amount: 0, due_amount: 160, paid_amount: 0, difference: 160,
  error: "", source: { field: "days", configured_source: "days" }, employment_status: "active",
  resigned_at: null, excluded: false, original_base_amount: 160,
  participation_history: [], adjustments: [], payments: [], clearances: [],
}));
const batch: MealBatch = {
  id: 1, month: "2026-09", recharge_month: "2026-10", status: "confirmed", version: 1,
  source_changed: false, items, departments: [],
};
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const queryCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/query?"));
const renderPage = () => render(<ConfirmProvider><MealTicketQueryPage /></ConfirmProvider>);

beforeEach(() => {
  fetchMock.mockReset().mockImplementation((url: string) => Promise.resolve(json(url.includes("/query-options?") ? options : batch)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MealTicketQueryPage", () => {
  it("打开页面只加载选择器选项，点击查询后才读取整月结果", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    expect(queryCalls()).toHaveLength(0);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("/query-options?"))).toBe(true);
    expect(screen.queryByText("E001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await screen.findByText("E001");
    expect(screen.getByText("E002")).toBeInTheDocument();
    expect(queryCalls()).toHaveLength(1);
    expect(String(queryCalls()[0][0])).toMatch(/\/query\?recharge_month=\d{4}-\d{2}$/);
  });

  it("选择条件后由后端查询，修改条件不会自动查询", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(json(url.includes("/query-options?") ? options : { ...batch, items: [items[1]] })));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择员工" }));
    const employeeDialog = screen.getByRole("dialog", { name: "选择员工" });
    fireEvent.click(within(employeeDialog).getByLabelText("E002 - 李四"));
    fireEvent.click(within(employeeDialog).getByRole("button", { name: "确定" }));
    fireEvent.click(screen.getByRole("button", { name: "展开选择面板" }));
    const departmentDialog = screen.getByRole("dialog", { name: "选择关联部门" });
    fireEvent.click(within(departmentDialog).getByRole("button", { name: "历史二部" }));
    fireEvent.click(within(departmentDialog).getByRole("button", { name: "确定" }));
    fireEvent.change(screen.getByLabelText("人员类型"), { target: { value: "manager" } });
    fireEvent.change(screen.getByLabelText("核对状态"), { target: { value: "unpaid" } });
    expect(queryCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await screen.findByText("E002");
    expect(screen.queryByText("E001")).not.toBeInTheDocument();
    const query = new URL(String(queryCalls()[0][0]), "http://localhost").searchParams;
    expect(query.getAll("emp_ids")).toEqual(["2"]);
    expect(query.getAll("dept_names")).toEqual(["历史二部"]);
    expect(query.get("person_type")).toBe("manager");
    expect(query.get("state")).toBe("unpaid");
    fireEvent.change(screen.getByLabelText("核对状态"), { target: { value: "settled" } });
    expect(queryCalls()).toHaveLength(1);
    expect(screen.queryByText("E002")).not.toBeInTheDocument();
  });

  it("切换月份只更新选项，旧月份未完成的查询不能覆盖页面", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => url.includes("/query-options?")
      ? Promise.resolve(json(options)) : new Promise<Response>(resolve => { finish = resolve; }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    fireEvent.change(screen.getByLabelText("充值月份"), { target: { value: "2025-01" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    await act(async () => { finish(json(batch)); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/meal-tickets/query-options?recharge_month=2025-01", expect.anything()));
    expect(queryCalls()).toHaveLength(1);
    expect(screen.queryByText("E001")).not.toBeInTheDocument();
  });

  it("修改条件重新查询后，旧请求不能覆盖新结果", async () => {
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/query-options?")) return Promise.resolve(json(options));
      if (url.includes("person_type=manager")) return Promise.resolve(json({ ...batch, items: [items[1]] }));
      return new Promise<Response>(resolve => { finishOld = resolve; });
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    fireEvent.change(screen.getByLabelText("人员类型"), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await screen.findByText("E002");
    await act(async () => { finishOld(json(batch)); });
    expect(screen.getByText("E002")).toBeInTheDocument();
    expect(screen.queryByText("E001")).not.toBeInTheDocument();
  });

  it("选项加载失败时提示错误并禁止查询", async () => {
    fetchMock.mockResolvedValue(json({ error: "选项读取失败" }, 500));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("选项读取失败");
    expect(screen.getByRole("button", { name: "查询" })).toBeDisabled();
    expect(queryCalls()).toHaveLength(0);
  });

  it("查询失败会显示错误，不把失败当作月份没有数据", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes("/query-options?")
      ? json(options) : json({ error: "账目读取失败" }, 500)));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("账目读取失败");
    expect(screen.queryByText("本充值月份没有核算数据")).not.toBeInTheDocument();
  });
});

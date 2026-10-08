import { act, render as renderView, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import MealTicketPage from "./MealTicketPage";
import { ConfirmProvider } from "../components/feedback/ConfirmDialog";

const render = (ui: Parameters<typeof renderView>[0]) => renderView(<ConfirmProvider>{ui}</ConfirmProvider>);
function pickEmployee(label: string) {
  fireEvent.click(screen.getByTitle("选择员工"));
  const picker = within(screen.getByRole("dialog", { name: "选择员工" }));
  fireEvent.click(picker.getByLabelText(label));
  fireEvent.click(picker.getByRole("button", { name: "确定" }));
}

const batch = { id: 1, month: "2026-08", recharge_month: "2026-09", version: 1, status: "draft", source_changed: false,
  departments: [{ dept_name: "生产部", count: 1, due_amount: 176, base_amount: 176, adjustment_amount: 0, paid_amount: 0, difference: 176 }],
  items: [{ id: 1, emp_id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", days: 22, base_amount: 176,
    adjustment_amount: 0, due_amount: 176, paid_amount: 0, difference: 176, error: "", source: {}, adjustments: [], payments: [] }] };
const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (p: string) => p }));

describe("菜票中心", () => {
  beforeEach(() => { sessionStorage.clear(); request.mockClear(); });
  it("核算部门支持多选，汇总和人员视图采用同一部门范围", async () => {
    const current = { ...batch, items: [
      batch.items[0],
      { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", dept_name: "研发部" },
      { ...batch.items[0], id: 3, emp_id: 3, emp_no: "003", name: "员工丙", dept_name: "未选部门" },
    ] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.click(screen.getByTitle("展开选择面板"));
    const picker = within(screen.getByRole("dialog", { name: "选择关联部门" }));
    fireEvent.click(picker.getByRole("button", { name: "生产部" }));
    fireEvent.click(picker.getByRole("button", { name: "研发部" }));
    fireEvent.click(picker.getByRole("button", { name: "确定" }));
    expect(screen.getByPlaceholderText("搜索部门编号/名称")).toHaveValue("已选 2 个部门");
    const summary = within(screen.getByRole("table"));
    expect(summary.getByRole("button", { name: "生产部" })).toBeInTheDocument();
    expect(summary.getByRole("button", { name: "研发部" })).toBeInTheDocument();
    expect(summary.queryByRole("button", { name: "未选部门" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "人员明细" }));
    const detail = within(screen.getByRole("table"));
    expect(detail.getByText("员工甲")).toBeInTheDocument();
    expect(detail.getByText("员工乙")).toBeInTheDocument();
    expect(detail.queryByText("员工丙")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空已选内容" }));
    expect(within(screen.getByRole("table")).getByRole("button", { name: "未选部门" })).toBeInTheDocument();
  });
  it("同一张表根据人员或部门选择切换，部门可进入人员明细", async () => {
    const current = { ...batch, departments: [], items: [
      { ...batch.items[0], employment_status: "resigned", resigned_at: "2026-09-01", dept_name: "原生产部" },
      { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", dept_name: "原生产部" },
      { ...batch.items[0], id: 3, emp_id: 3, emp_no: "003", name: "员工丙", dept_name: "其他部" },
    ] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.click(screen.getByTitle("选择员工"));
    const people = within(screen.getByRole("dialog", { name: "选择员工" }));
    fireEvent.click(people.getByLabelText("001 - 员工甲"));
    fireEvent.click(people.getByLabelText("003 - 员工丙"));
    fireEvent.click(people.getByRole("button", { name: "确定" }));
    const table = within(screen.getByRole("region", { name: "人员明细" }));
    expect(table.getByText("员工甲")).toBeInTheDocument();
    expect(table.getByText("员工丙")).toBeInTheDocument();
    expect(table.queryByText("员工乙")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("展开选择面板"));
    const departments = within(screen.getByRole("dialog", { name: "选择关联部门" }));
    fireEvent.click(departments.getByRole("button", { name: "原生产部" }));
    fireEvent.click(departments.getByRole("button", { name: "确定" }));
    const summary = within(within(screen.getByRole("region", { name: "部门汇总" })).getByRole("table"));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(summary.getByRole("button", { name: "原生产部" })).toBeInTheDocument();
    expect(summary.getByText("2", { selector: "td" })).toBeInTheDocument();
    expect(summary.getAllByRole("row")[1].children[4]).toHaveTextContent("352.00");
    expect(summary.queryByText("员工甲")).not.toBeInTheDocument();
    fireEvent.click(summary.getByRole("button", { name: "原生产部" }));
    const detail = within(screen.getByRole("region", { name: "人员明细" }));
    expect(detail.getByText("员工甲")).toBeInTheDocument();
    expect(detail.getByText("员工乙")).toBeInTheDocument();
    expect(detail.queryByText("员工丙")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    pickEmployee("003 - 员工丙");
    expect(detail.getByText("员工丙")).toBeInTheDocument();
    expect(detail.queryByText("员工甲")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索部门编号/名称")).toHaveValue("");
    expect(request.mock.calls.every(([path]) => path !== "/api/admin/employees?status=all")).toBe(true);
  });
  it("筛选结果可全选，批量本月不发与恢复核算记录相同原因", async () => {
    let current = { ...batch, items: [batch.items[0], { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙" }] };
    request.mockImplementation((path: string, options?: { body?: { item_id: number; excluded: boolean; reason: string; version: number } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/participation") {
        expect(options!.body!.version).toBe(current.version);
        current = { ...current, version: current.version + 1, items: current.items.map(item => item.id === options!.body!.item_id
          ? { ...item, excluded: options!.body!.excluded, due_amount: options!.body!.excluded ? 0 : 176, difference: options!.body!.excluded ? 0 : 176 } : item) };
      }
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "全选筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "批量本月不发" }));
    expect(screen.getByRole("button", { name: "确认本月不发" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "离职" }));
    fireEvent.click(screen.getByRole("button", { name: "确认本月不发" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(current.items.every(item => (item as { excluded?: boolean }).excluded)).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "批量恢复核算" }));
    fireEvent.change(screen.getByLabelText("处理原因"), { target: { value: "核对后结算" } });
    fireEvent.click(screen.getByRole("button", { name: "确认恢复核算" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(current.items.every(item => !(item as { excluded?: boolean }).excluded)).toBe(true);
    expect(request.mock.calls.filter(([path]) => path === "/api/meal-tickets/participation")).toHaveLength(4);
  });

  it("批量补扣中途失败只保留未成功人员，重试不会重复补扣", async () => {
    let current = { ...batch, items: [batch.items[0], { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙" }] };
    let fail = true;
    request.mockImplementation((path: string, options?: { body?: { item_id: number; amount: string } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/adjustments") {
        if (options!.body!.item_id === 2 && fail) { fail = false; return Promise.reject(new Error("第二人保存失败")); }
        current = { ...current, version: current.version + 1, items: current.items.map(item => item.id === options!.body!.item_id
          ? { ...item, adjustment_amount: item.adjustment_amount + Number(options!.body!.amount) } : item) };
      }
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "全选筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "批量补发 / 扣除" }));
    fireEvent.change(screen.getByLabelText("每人调整金额（元）"), { target: { value: "-8" } });
    fireEvent.click(screen.getByRole("button", { name: "线长补卡" }));
    expect(screen.getByText("本次处理 2 人 · 合计调整 -16.00 元")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存补扣" })).toBeEnabled());
    expect(screen.getByText("本次处理 1 人 · 合计调整 -8.00 元")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(current.items.map(item => item.adjustment_amount)).toEqual([-8, -8]);
    expect(request.mock.calls.filter(([path, options]) => path === "/api/meal-tickets/adjustments" && options.body.item_id === 1)).toHaveLength(1);
  });

  it("多选跨页保持当前页，全选只作用于当前筛选人员", async () => {
    const items = Array.from({ length: 105 }, (_, index) => ({ ...batch.items[0], id: index + 1, emp_id: index + 1, emp_no: String(index + 1), name: `人员${index + 1}` }));
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : { ...batch, items }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("人员1");
    fireEvent.click(within(screen.getByRole("region", { name: "人员明细" })).getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 101" }));
    expect(screen.getByRole("checkbox", { name: "选择 101" })).toBeChecked();
    expect(screen.getByText("已选 1 人")).toBeInTheDocument();
    pickEmployee("105 - 人员105");
    fireEvent.click(screen.getByRole("checkbox", { name: "全选筛选结果" }));
    expect(screen.getByText("已选 2 人")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect(screen.getByRole("checkbox", { name: "选择 105" })).not.toBeChecked();
  });
  it("异常列表自动显示离职登记核对结果，仍保留不发或结算选择", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const current = { ...batch, items: [
      { ...batch.items[0], error: "缺少考勤来源，请核对", employment_status: "resigned", resigned_at: "2026-09-01" },
      { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", error: "缺少考勤来源，请核对", employment_status: "active", resigned_at: null },
    ] };
    let reads = 0;
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      reads += 1;
      return Promise.resolve(reads === 1 ? { ...current, items: current.items.map(item => ({ ...item, employment_status: "active", resigned_at: null })) } : current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    const issues = await screen.findByRole("button", { name: "查看异常（2 人）" });
    await act(async () => fireEvent.click(issues));
    expect(reads).toBe(2);
    const table = within(screen.getByRole("region", { name: "人员明细" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("已登记离职 · 2026-09-01")).toBeInTheDocument();
    expect(within(rows[1]).getByText("未登记离职")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "本月不发" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "补扣" })).toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
    fireEvent.click(within(rows[0]).getByRole("button", { name: "明细" }));
    expect(within(screen.getByRole("dialog", { name: "菜票明细" })).getByText("员工档案核对：已登记离职 · 2026-09-01")).toBeInTheDocument();
  });
  it.each(["calculation", "payments"] as const)("%s 一键异常清除其他筛选并覆盖跨页人员", async view => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const normal = Array.from({ length: 100 }, (_, index) => ({ ...batch.items[0], id: index + 1, emp_id: index + 1,
      name: `正常人员${index + 1}`, emp_no: String(index + 1), is_manager: false }));
    const current = { ...batch, status: view === "payments" ? "confirmed" : "draft", items: [...normal,
      { ...batch.items[0], id: 101, emp_id: 101, name: "缺少来源人员", error: "缺少考勤来源，请核对", dept_name: "其他部", is_manager: true },
      { ...batch.items[0], id: 102, emp_id: 102, name: "负数应发人员", due_amount: -8, difference: -8, is_manager: true },
      { ...batch.items[0], id: 103, emp_id: 103, name: "已处理离职人员", error: "缺少考勤来源，请核对", excluded: true, due_amount: 0, difference: 0 },
    ] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage view={view} /></MemoryRouter>);
    await screen.findByText("正常人员1");
    pickEmployee("1 - 正常人员1");
    fireEvent.click(screen.getByTitle("展开选择面板"));
    const departmentPicker = within(screen.getByRole("dialog", { name: "选择关联部门" }));
    fireEvent.click(departmentPicker.getByRole("button", { name: "生产部" }));
    fireEvent.click(departmentPicker.getByRole("button", { name: "确定" }));
    fireEvent.change(screen.getByLabelText("人员类型"), { target: { value: "employee" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查看异常（2 人）" })));
    expect(screen.getByPlaceholderText("搜索员工编号/姓名")).toHaveValue("");
    expect(screen.getByPlaceholderText("搜索部门编号/名称")).toHaveValue("");
    expect(screen.getByLabelText("人员类型")).toHaveValue("");
    expect(screen.getByLabelText("发放 / 核算状态")).toHaveValue("issue");
    const table = within(screen.getByRole("region", { name: "人员明细" })).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("缺少来源人员")).toBeInTheDocument();
    expect(within(table).getByText("负数应发人员")).toBeInTheDocument();
    expect(within(table).queryByText("已处理离职人员")).not.toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
  });

  it("异常人员确认离职本月不发后退出异常列表，数量自动更新", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    let current = { ...batch, items: [{ ...batch.items[0], error: "缺少考勤来源，请核对", excluded: false }] };
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/participation") current = { ...current, version: 2,
        items: [{ ...current.items[0], excluded: true, base_amount: 0, due_amount: 0, difference: 0 }] };
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    const issues = await screen.findByRole("button", { name: "查看异常（1 人）" });
    await act(async () => fireEvent.click(issues));
    expect(screen.getByRole("button", { name: "确认核算" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "本月不发" }));
    fireEvent.click(screen.getByRole("button", { name: "离职" }));
    fireEvent.click(screen.getByRole("button", { name: "确认本月不发" }));
    expect(await screen.findByRole("button", { name: "查看异常（0 人）" })).toBeDisabled();
    expect(screen.queryByText("员工甲")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认核算" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("发放 / 核算状态"), { target: { value: "excluded" } });
    expect(screen.getByText("员工甲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复核算" })).toBeInTheDocument();
  });
  it("月度发放确认后才能导出，并在同页登记充值直至结清", async () => {
    let current = batch;
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/confirm") current = { ...current, status: "confirmed", version: 2 };
      if (path === "/api/meal-tickets/payments") current = { ...current, version: 3, items: [{ ...current.items[0], paid_amount: 176, difference: 0 }] };
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    expect(within(screen.getByRole("list", { name: "月度发放流程" })).getAllByRole("listitem").map(item => within(item).getByRole("heading").textContent))
      .toEqual(["生成草稿", "补发 / 扣除", "确认核算", "导出充值表", "登记充值", "核对结清"]);
    expect(screen.queryByRole("link", { name: "导出充值表（.xls）" })).not.toBeInTheDocument();
    const exportStep = within(screen.getByRole("list", { name: "月度发放流程" })).getAllByRole("listitem")[3];
    expect(within(exportStep).getByRole("button", { name: "核算后可导出" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "登记充值" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认核算" }));
    expect(await screen.findByRole("link", { name: "导出充值表（.xls）" })).toHaveAttribute("href",
      expect.stringContaining("/api/meal-tickets/export-recharge?recharge_month="));
    expect(within(exportStep).getByRole("link", { name: "导出充值表（.xls）" })).toBeInTheDocument();
    expect(within(exportStep).getByText("员工编号 / 充值金额")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登记充值" }));
    fireEvent.change(screen.getByLabelText("凭证 / 说明"), { target: { value: "充值成功凭证" } });
    fireEvent.click(screen.getByRole("button", { name: "确认登记" }));
    expect(await screen.findByText("本月账目已结清")).toBeInTheDocument();
  });

  it("后续页面只处理已核算账目，草稿引导回月度发放", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    expect(await screen.findByText("请先完成月度核算")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往月度发放" })).toHaveAttribute("href", expect.stringContaining("/meal-tickets/calculation?recharge_month="));
    expect(screen.queryByRole("button", { name: "生成 / 重算草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认核算" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补扣" })).not.toBeInTheDocument();
  });

  it("后续补扣产生差额，实际充值登记后再次结清", async () => {
    let current = { ...batch, status: "confirmed", items: [{ ...batch.items[0], paid_amount: 176, difference: 0 }] };
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/adjustments") current = { ...current, version: 2, items: [{ ...current.items[0], adjustment_amount: 8, due_amount: 184, difference: 8 }] };
      if (path === "/api/meal-tickets/payments") current = { ...current, version: 3, items: [{ ...current.items[0], paid_amount: 184, difference: 0 }] };
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    await screen.findByText("本月账目已结清");
    expect(screen.queryByRole("button", { name: "生成 / 重算草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补扣" }));
    fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "线长补卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await screen.findByText("还有差额需要处理");
    fireEvent.click(screen.getByRole("button", { name: "登记充值" }));
    fireEvent.change(screen.getByLabelText("凭证 / 说明"), { target: { value: "补充充值成功" } });
    fireEvent.click(screen.getByRole("button", { name: "确认登记" }));
    expect(await screen.findByText("本月账目已结清")).toBeInTheDocument();
  });

  it("结清逐人检查整月，不受差额抵消和筛选影响", async () => {
    const current = { ...batch, status: "confirmed", items: [
      { ...batch.items[0], paid_amount: 168, difference: 8 },
      { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", paid_amount: 184, difference: -8 },
      { ...batch.items[0], id: 3, emp_id: 3, emp_no: "003", name: "员工丙", paid_amount: 176, difference: 0 },
    ] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工丙");
    pickEmployee("003 - 员工丙");
    const summary = within(screen.getByRole("region", { name: "整月结清检查" }));
    expect(summary.getByText("还有差额需要处理")).toBeInTheDocument();
    expect(summary.getByText("待充值 1 人 · 待扣回 1 人 · 异常 0 人")).toBeInTheDocument();
  });

  it("两个缓存页面切换时携带月份并读取最新核算状态", async () => {
    let current = batch;
    sessionStorage.setItem("meal-ticket-month-payments", "2026-08");
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/confirm") current = { ...current, status: "confirmed", version: 2 };
      return Promise.resolve(current);
    });
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation?recharge_month=2026-09"]}>
      <MealTicketPage /><MealTicketPage view="payments" />
    </MemoryRouter>);
    const initial = within(screen.getByRole("heading", { name: "月度发放" }).closest("main")!);
    const followup = within(screen.getByRole("heading", { name: "后续补扣与对账" }).closest("main")!);
    await initial.findByText("员工甲");
    await followup.findByText("请先完成月度核算");
    fireEvent.click(initial.getByRole("button", { name: "确认核算" }));
    fireEvent.click(await initial.findByRole("link", { name: "前往后续补扣与对账" }));
    expect(await followup.findByText("员工甲")).toBeInTheDocument();
    expect(followup.getByLabelText("计划充值月份")).toHaveValue("2026-09");
    expect(followup.getByRole("button", { name: "补扣" })).toBeInTheDocument();
  });

  it("充值请求进行中切到另一月份，完成后再加载新月避免旧响应覆盖", async () => {
    let finishPayment!: (value: object) => void;
    const confirmed = { ...batch, status: "confirmed" };
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/meal-tickets/payments" ? new Promise(resolve => { finishPayment = resolve; })
      : path.endsWith("recharge_month=2026-10") ? Promise.resolve({ ...confirmed, id: 2, recharge_month: "2026-10", items: [{ ...batch.items[0], name: "十月员工" }] })
      : Promise.resolve(confirmed));
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation?recharge_month=2026-09"]}>
      <Link to="/meal-tickets/calculation?recharge_month=2026-10">切到十月</Link><MealTicketPage />
    </MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "登记充值" }));
    fireEvent.change(screen.getByLabelText("凭证 / 说明"), { target: { value: "九月实际充值" } });
    fireEvent.click(screen.getByRole("button", { name: "确认登记" }));
    fireEvent.click(screen.getByRole("link", { name: "切到十月" }));
    expect(screen.getByLabelText("计划充值月份")).toHaveValue("2026-09");
    await act(async () => finishPayment({ ...confirmed, version: 2, items: [{ ...batch.items[0], paid_amount: 176, difference: 0 }] }));
    expect(await screen.findByText("十月员工")).toBeInTheDocument();
    expect(screen.getByLabelText("计划充值月份")).toHaveValue("2026-10");
    expect(screen.queryByText("员工甲")).not.toBeInTheDocument();
  });
  it.each(["离职", "工资算菜票"])("本月不发常用语 %s 可填入原因，空白原因不能修改", async phrase => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "本月不发" }));
    const dialog = within(screen.getByRole("dialog", { name: "核算处理" }));
    const save = dialog.getByRole("button", { name: "确认本月不发" });
    expect(save).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("处理原因"), { target: { value: "   " } });
    fireEvent.submit(save.closest("form")!);
    expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/participation")).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: phrase }));
    expect(dialog.getByLabelText("处理原因")).toHaveValue(phrase);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets/participation", expect.objectContaining({
      body: expect.objectContaining({ reason: phrase, excluded: true }),
    })));
  });

  it("补扣常用语支持线长补卡和选择具体月份，原因可继续编辑", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "补扣" }));
    const dialog = within(screen.getByRole("dialog", { name: "额外补扣" }));
    const save = dialog.getByRole("button", { name: "保存补扣" });
    expect(save).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "线长补卡" }));
    expect(dialog.getByLabelText("调整原因")).toHaveValue("线长补卡");
    fireEvent.click(dialog.getByRole("button", { name: "补x月菜票" }));
    expect(save).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("补发月份"), { target: { value: "8" } });
    expect(dialog.getByLabelText("调整原因")).toHaveValue("补8月菜票");
    fireEvent.change(dialog.getByLabelText("调整原因"), { target: { value: "补8月菜票，核对后补发" } });
    fireEvent.change(dialog.getByLabelText("调整金额（元）"), { target: { value: "16" } });
    fireEvent.click(save);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets/adjustments", expect.objectContaining({
      body: expect.objectContaining({ amount: "16", reason: "补8月菜票，核对后补发" }),
    })));
  });

  it("加载进度只随实际权限和账目请求完成而推进", async () => {
    let finishAuth!: (value: object) => void;
    let finishBatch!: (value: object) => void;
    request.mockImplementation((path: string) => new Promise(resolve => {
      if (path === "/api/auth/me") finishAuth = resolve; else finishBatch = resolve;
    }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    expect(screen.getByRole("progressbar", { name: "页面加载进度" })).toHaveAttribute("aria-valuenow", "0");
    await act(async () => finishAuth({ role: "admin" }));
    expect(screen.getByRole("progressbar", { name: "页面加载进度" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("已完成 1 / 2 项请求")).toBeInTheDocument();
    await act(async () => finishBatch(batch));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("员工甲")).toBeInTheDocument();
  });

  it("历史台账等待人员映射完成后才结束加载", async () => {
    let finishPeople!: (value: object[]) => void;
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/admin/employees?status=all" ? new Promise(resolve => { finishPeople = resolve; })
      : Promise.resolve([]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("已完成 2 / 3 项请求")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: "页面加载进度" })).toHaveAttribute("aria-valuenow", "67");
    expect(screen.getByRole("button", { name: "预览导入" })).toBeDisabled();
    await act(async () => finishPeople([]));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("单次修改等待真实响应，失败时保留输入并结束等待", async () => {
    let fail!: (error: Error) => void;
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/meal-tickets/adjustments" ? new Promise((_, reject) => { fail = reject; })
      : Promise.resolve(batch));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "补扣" }));
    fireEvent.click(screen.getByRole("button", { name: "线长补卡" }));
    fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    expect(screen.getByRole("progressbar", { name: "操作进度" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("button", { name: "保存补扣" })).toBeDisabled();
    await act(async () => fail(new Error("保存失败，请重试")));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("调整原因")).toHaveValue("线长补卡");
    expect(screen.getByRole("button", { name: "保存补扣" })).toBeEnabled();
    expect(screen.getAllByRole("alert").some(alert => alert.textContent === "保存失败，请重试")).toBe(true);
  });

  it("批量充值不沿用补月份模板，按成功登记人数显示进度", async () => {
    const confirmed = { ...batch, status: "confirmed", items: [batch.items[0], { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙" }] };
    const payments: Array<(value: object) => void> = [];
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/meal-tickets/payments" ? new Promise(resolve => { payments.push(resolve); })
      : Promise.resolve(confirmed));
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    await screen.findByText("员工乙");
    fireEvent.click(screen.getAllByRole("button", { name: "补扣" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "补x月菜票" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByLabelText("选择 001"));
    fireEvent.click(screen.getByLabelText("选择 002"));
    fireEvent.click(screen.getByRole("button", { name: "登记选中人员充值" }));
    const dialog = within(screen.getByRole("dialog", { name: "批量充值" }));
    expect(dialog.queryByLabelText("补发月份")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "确认登记" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("凭证 / 说明"), { target: { value: "充值凭证001" } });
    fireEvent.click(dialog.getByRole("button", { name: "确认登记" }));
    expect(screen.getByRole("progressbar", { name: "批量充值进度" })).toHaveAttribute("aria-valuenow", "0");
    const partial = { ...confirmed, version: 2, items: [{ ...confirmed.items[0], paid_amount: 176, difference: 0 }, confirmed.items[1]] };
    await act(async () => payments[0](partial));
    expect(screen.getByRole("progressbar", { name: "批量充值进度" })).toHaveAttribute("aria-valuenow", "50");
    expect(payments).toHaveLength(2);
    await act(async () => payments[1]({ ...partial, version: 3, items: partial.items.map(item => ({ ...item, paid_amount: 176, difference: 0 })) }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "批量充值" })).not.toBeInTheDocument();
    expect(screen.getAllByText("结清", { selector: "span" })).toHaveLength(2);
  });

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
    expect(screen.queryByRole("button", { name: "本月不发" })).not.toBeInTheDocument();
  });

  it("本月不发填写原因后解除确认阻塞，并可恢复核算", async () => {
    let current = { ...batch, items: [{ ...batch.items[0], error: "缺少考勤来源，请核对", excluded: false,
      original_base_amount: 176, participation_history: [] as Array<{ excluded: boolean; reason: string; operator: string; created_at: string }> }] };
    request.mockImplementation((path: string, options?: { body?: { excluded: boolean; reason: string } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/participation") {
        const excluded = options!.body!.excluded;
        current = { ...current, version: current.version + 1, items: [{ ...current.items[0], excluded,
          base_amount: excluded ? 0 : 176, due_amount: excluded ? 0 : 176, difference: excluded ? 0 : 176,
          participation_history: [...current.items[0].participation_history, { excluded, reason: options!.body!.reason, operator: "admin", created_at: "2026-09-01" }] }] };
      }
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    expect(screen.getByRole("button", { name: "确认核算" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "本月不发" }));
    const form = within(screen.getByRole("dialog", { name: "核算处理" }));
    expect(form.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.change(form.getByLabelText("处理原因"), { target: { value: "实际八月离职，本月不发" } });
    fireEvent.click(form.getByRole("button", { name: "确认本月不发" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认核算" })).toBeEnabled());
    expect(screen.getByText("本月不发", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    expect(screen.getByText(/实际八月离职，本月不发/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复核算" }));
    fireEvent.change(screen.getByLabelText("处理原因"), { target: { value: "核对后决定结算" } });
    fireEvent.click(screen.getByRole("button", { name: "确认恢复核算" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "本月不发" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "确认核算" })).toBeDisabled();
  });

  it("状态排序将跨页的核算问题排到前面，再次点击反向排序", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...batch.items[0],
      id: index + 1, emp_id: index + 1, emp_no: String(index + 1), name: `已结清${index + 1}`, paid_amount: 176, difference: 0 }));
    items.push(
      { ...batch.items[0], id: 101, emp_id: 101, name: "部分发放人员", paid_amount: 80, difference: 96 },
      { ...batch.items[0], id: 102, emp_id: 102, name: "未发人员" },
      { ...batch.items[0], id: 103, emp_id: 103, name: "待扣回人员", paid_amount: 180, difference: -4 },
      { ...batch.items[0], id: 104, emp_id: 104, name: "负数应发人员", adjustment_amount: -180, due_amount: -4, difference: -4 },
      { ...batch.items[0], id: 105, emp_id: 105, name: "考勤异常人员", error: "缺少考勤来源，请核对" },
    );
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : { ...batch, items }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("已结清1");
    expect(screen.queryByText("考勤异常人员")).not.toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "人员明细" })).getByRole("table");
    const names = () => within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[2].textContent);
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
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : { ...batch, status: "confirmed" }));
    const first = render(<MemoryRouter initialEntries={["/meal-tickets/payments"]}><MealTicketPage view="payments" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "后续补扣与对账" })).toBeInTheDocument();
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
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(screen.getByRole("button", { name: "读取考勤试算对比" }));
    await screen.findByText("员工甲");
    expect(screen.getByText("176.00")).toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
  });
});

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
vi.mock("../api/client", () => ({ apiRequest: async (path: string, options?: object) => {
  const result = await request(path, options);
  if (path.includes("followup-tasks") && !Array.isArray(result?.tasks)) return {
    batch_id: result?.id ?? 1, batch_version: result?.version ?? 1, offset_enabled: true, settings_digest: "s",
    queue_offset_enabled: true, settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: null, tasks: [],
  };
  return result;
}, buildApiUrl: (p: string) => p }));

describe("菜票中心", () => {
  beforeEach(() => { sessionStorage.clear(); request.mockClear(); });
  it("无批次只计算一次，草稿仅一个重算入口，步骤条无操作", async () => {
    let current: typeof batch | null = null;
    request.mockImplementation((path: string, options?: { body?: object }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/generate") {
        expect(options?.body).toEqual(expect.objectContaining({ recharge_month: "2026-09" }));
        current = batch;
      }
      return Promise.resolve(current);
    });
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation?recharge_month=2026-09"]}><MealTicketPage /></MemoryRouter>);
    const calculate = await screen.findByRole("button", { name: "计算菜票" });
    expect(screen.getByText("考勤月份：2026-08")).toBeInTheDocument();
    fireEvent.click(calculate);
    await screen.findByText("员工甲");
    const flow = within(screen.getByRole("list", { name: "月度发放流程" }));
    expect(flow.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("计划充值月份")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "重算草稿" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "补扣" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "本月不发" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重算草稿" }));
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path === "/api/meal-tickets/generate")).toHaveLength(2));
  });

  it("下载可重复且不证明充值，确认后仍处于导出并充值", async () => {
    const current = { ...batch, status: "confirmed", database: { enabled: true, configured: true } };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    const flow = screen.getByRole("list", { name: "月度发放流程" });
    expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent("导出并充值");
    expect(within(flow).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "导出充值表（.xls）" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "已完成充值，核对到账" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "前往导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补扣" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "人员明细" })).not.toBeVisible();
    const download = screen.getByRole("link", { name: "导出充值表（.xls）" });
    download.addEventListener("click", event => event.preventDefault());
    fireEvent.click(download); fireEvent.click(download);
    expect(flow.querySelector('[aria-current="step"]')).toHaveTextContent("导出并充值");
    expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/payments" || path === "/api/meal-tickets/reconcile")).toBe(false);
  });

  it("草稿重算保留补扣、本月不发，并显示应发金额变化", async () => {
    let current = { ...batch, source_changed: true, items: [
      { ...batch.items[0], adjustment_amount: 16, due_amount: 192, difference: 192 },
      { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", excluded: true, base_amount: 0, due_amount: 0, difference: 0 },
    ] };
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/generate") current = { ...current, source_changed: false, version: 2,
        items: [{ ...current.items[0], days: 23, base_amount: 184, due_amount: 200, difference: 200 }, current.items[1]] };
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "重算草稿" }));
    expect(await screen.findByText("001 员工甲：192.00 → 200.00 元")).toBeInTheDocument();
    const row = within(screen.getByText("员工甲").closest("tr")!);
    expect(row.getByText("16.00")).toBeInTheDocument();
    const excluded = within(screen.getByText("员工乙").closest("tr")!);
    expect(excluded.getByRole("button", { name: "恢复核算" })).toBeEnabled();
    expect(excluded.queryByRole("button", { name: "补扣" })).not.toBeInTheDocument();
    expect(screen.queryByText(/源考勤或人员资料已变化/)).not.toBeInTheDocument();
  });

  it.each([false, true])("菜票明细显示异常日扣减依据（后续重算：%s）", async (recalculated) => {
    const rule = { abnormal_deduction_enabled: true, as_manager: false,
      abnormal_dates: ["2026-08-01", "2026-08-02"], deduction_cents: 1600 };
    const source = recalculated
      ? { attendance_recalculation: { source: { meal_ticket_rule: rule } } }
      : { meal_ticket_rule: rule };
    const current = { ...batch, items: [{ ...batch.items[0], source }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    const detail = within(screen.getByRole("dialog", { name: "菜票明细" }));
    expect(detail.getByText("异常考勤 2 天 · 菜票扣除 16.00 元")).toBeInTheDocument();
    expect(detail.getByText(/2026-08-01、2026-08-02/)).toBeInTheDocument();
  });

  it("后续补扣页面在已结清时仍提供导入入口", async () => {
    const current = { ...batch, status: "confirmed", items: [{ ...batch.items[0], paid_amount: 176, difference: 0 }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    await screen.findByRole("button", { name: "导入补扣清单" });
    fireEvent.click(screen.getByLabelText("显示全部人员"));
    expect(screen.getByText("员工甲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入补扣清单" })).toBeEnabled();
  });

  it("导入预览期间切换同月链接不会卡住页面", async () => {
    let finishPreview!: (value: object) => void;
    const current = { ...batch, status: "confirmed" };
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/meal-tickets/adjustment-import/preview" ? new Promise(resolve => { finishPreview = resolve; })
      : Promise.resolve(current));
    render(<MemoryRouter initialEntries={["/meal-tickets/payments?recharge_month=2026-09"]}>
      <Link to="/meal-tickets/payments?recharge_month=2026-09&refresh=1">切换同月页面</Link><MealTicketPage view="payments" />
    </MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.click(screen.getByRole("button", { name: "导入补扣清单" }));
    fireEvent.change(screen.getByLabelText("补扣 Excel 文件"), { target: { files: [new File(["data"], "补扣.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }));
    fireEvent.click(screen.getByRole("link", { name: "切换同月页面" }));
    await act(async () => finishPreview({ filename: "补扣.xlsx", rows: [], total_amount: 0, error_count: 0, token: "preview" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导入补扣清单" })).toBeEnabled());
  });

  it("月度发放点击月份箭头展开面板并可选择月份", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : batch));
    render(<MemoryRouter initialEntries={["/meal-tickets/calculation?recharge_month=2026-09"]}><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    const input = screen.getByRole("textbox", { name: "计划充值月份" });
    const trigger = input.closest(".month-picker-split-trigger")!;
    fireEvent.click(trigger.querySelector(".month-picker-chevron")!);
    expect(trigger).toHaveClass("is-open");
    fireEvent.click(screen.getByRole("button", { name: "7月" }));
    await waitFor(() => expect(input).toHaveValue("2026-07"));
    expect(trigger).not.toHaveClass("is-open");
    fireEvent.click(input);
    expect(trigger).toHaveClass("is-open");
  });
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
    await waitFor(() => expect(screen.queryByRole("button", { name: /查看异常/ })).not.toBeInTheDocument());
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
      .toEqual(["选月份", "计算与核对", "导出并充值", "核对到账"]);
    const activeStep = screen.getByRole("list", { name: "月度发放流程" }).querySelector('[aria-current="step"]') as HTMLElement;
    expect(within(activeStep).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "确认核算" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "核对人员与补扣" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "导出充值表（.xls）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "充值表导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前往导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记充值" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认核算" }));
    const exportStep = await screen.findByRole("region", { name: "充值表导出" });
    expect(await screen.findByRole("link", { name: "导出充值表（.xls）" })).toHaveAttribute("href",
      expect.stringContaining("/api/meal-tickets/export-recharge?recharge_month="));
    expect(within(exportStep).getByRole("link", { name: "导出充值表（.xls）" })).toBeInTheDocument();
    expect(within(exportStep).getByText(/员工编号 \/ 充值金额/)).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "重算草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认核算" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补扣" })).not.toBeInTheDocument();
  });

  it("退回前确认影响，取消保留确认，确认退回后恢复草稿编辑", async () => {
    let current = { ...batch, status: "confirmed", version: 2 };
    request.mockImplementation((path: string, options?: { body?: { batch_id: number; version: number } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/unconfirm") {
        expect(options!.body).toEqual({ batch_id: 1, version: 2 });
        current = { ...current, status: "draft", version: 3 };
      }
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    const exportStep = screen.getByRole("region", { name: "充值表导出" });
    fireEvent.click(within(exportStep).getByRole("button", { name: "退回上一步" }));
    expect(screen.getByText(/已导出的充值表将失效/)).toBeInTheDocument();
    expect(within(exportStep).getByRole("link", { name: "导出充值表（.xls）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/unconfirm")).toBe(false);
    fireEvent.click(within(exportStep).getByRole("button", { name: "退回上一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认退回" }));
    expect(await screen.findByRole("button", { name: "确认核算" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重算草稿" })).toBeEnabled();
    screen.getAllByRole("button", { name: "本月不发" }).forEach(button => expect(button).toBeEnabled());
    expect(screen.queryByRole("link", { name: "导出充值表（.xls）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "充值表导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前往导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退回上一步" })).not.toBeInTheDocument();
  });

  it("已冲正且净已发为零的账目仍不能退回，人员筛选不影响限制", async () => {
    const current = { ...batch, status: "confirmed", items: [batch.items[0], {
      ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙", paid_amount: 0,
      payments: [
        { id: 1, kind: "recharge", amount: 8, date: "2026-09-05", reference: "充值", operator: "admin", reversed: true },
        { id: 2, kind: "reversal", amount: -8, date: "2026-09-05", reference: "冲正", operator: "admin", reversed: false },
      ],
    }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : current));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    pickEmployee("001 - 员工甲");
    expect(screen.queryByText("员工乙")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退回上一步" })).toBeDisabled();
    expect(screen.getByText(/已登记发放流水，请通过补扣或冲正处理/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "导出充值表（.xls）" })).toBeInTheDocument();
  });

  it("查询账号不显示退回入口", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "readonly" } : { ...batch, status: "confirmed" }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByRole("link", { name: "导出充值表（.xls）" });
    expect(screen.queryByRole("button", { name: "退回上一步" })).not.toBeInTheDocument();
  });

  it("退回被后端拒绝时保留已确认状态并展示原因", async () => {
    const current = { ...batch, status: "confirmed", version: 2 };
    request.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/unconfirm") return Promise.reject(new Error("数据已变化，请刷新后操作"));
      return Promise.resolve(current);
    });
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "退回上一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认退回" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("数据已变化，请刷新后操作");
    expect(screen.getByRole("link", { name: "导出充值表（.xls）" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认核算" })).not.toBeInTheDocument();
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
    await screen.findByRole("button", { name: "导入补扣清单" });
    fireEvent.click(screen.getByLabelText("显示全部人员"));
    expect(screen.getByRole("region", { name: "整月结清检查" })).toHaveTextContent("本月账目已结清");
    expect(screen.queryByRole("button", { name: "重算草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补扣" }));
    fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "线长补卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "额外补扣" })).not.toBeInTheDocument());
    await screen.findByText("还有差额需要处理");
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    fireEvent.click(screen.getByRole("button", { name: "登记实际充值流水" }));
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
      <Link to="/meal-tickets/payments?recharge_month=2026-09">进入后续补扣页面</Link>
      <MealTicketPage /><MealTicketPage view="payments" />
    </MemoryRouter>);
    const initial = within(screen.getByRole("heading", { name: "月度发放" }).closest("main")!);
    const followup = within(screen.getByRole("heading", { name: "后续补扣与对账" }).closest("main")!);
    await initial.findByText("员工甲");
    await followup.findByText("请先完成月度核算");
    fireEvent.click(initial.getByRole("button", { name: "确认核算" }));
    await initial.findByRole("link", { name: "导出充值表（.xls）" });
    expect(initial.queryByRole("link", { name: "前往后续补扣与对账" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "进入后续补扣页面" }));
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

  it("月度加载显示后台实际处理人数，权限完成不会虚增进度", async () => {
    let finishAuth!: (value: object) => void;
    let finishBatch!: (value: object) => void;
    request.mockImplementation((path: string) => path.startsWith("/api/meal-tickets/progress?")
      ? Promise.resolve({ status: "running", stage: "逐人核对考勤来源", completed: 3, total: 10 }) : new Promise(resolve => {
      if (path === "/api/auth/me") finishAuth = resolve; else finishBatch = resolve;
    }));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    expect(screen.getByRole("progressbar", { name: "页面加载进度" })).not.toHaveAttribute("aria-valuenow");
    await act(async () => finishAuth({ role: "admin" }));
    expect(screen.getByRole("progressbar", { name: "页面加载进度" })).not.toHaveAttribute("aria-valuenow");
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "页面加载进度" })).toHaveAttribute("aria-valuenow", "30"));
    expect(screen.getByText("逐人核对考勤来源")).toBeInTheDocument();
    expect(screen.getByText("当前阶段已完成 3 / 10 人")).toBeInTheDocument();
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

  it("月度批量实际登记按成功登记人数显示进度", async () => {
    const confirmed = { ...batch, status: "confirmed", items: [batch.items[0], { ...batch.items[0], id: 2, emp_id: 2, emp_no: "002", name: "员工乙" }] };
    const payments: Array<(value: object) => void> = [];
    request.mockImplementation((path: string) => path === "/api/auth/me" ? Promise.resolve({ role: "admin" })
      : path === "/api/meal-tickets/payments" ? new Promise(resolve => { payments.push(resolve); })
      : Promise.resolve(confirmed));
    render(<MemoryRouter><MealTicketPage /></MemoryRouter>);
    await screen.findByText("员工乙");
    fireEvent.click(screen.getByLabelText("选择 001"));
    fireEvent.click(screen.getByLabelText("选择 002"));
    fireEvent.click(screen.getByRole("button", { name: "登记选中人员充值" }));
    const dialog = within(screen.getByRole("dialog", { name: "批量充值" }));
    expect(dialog.queryByLabelText("补发月份")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "确认登记" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("凭证 / 说明"), { target: { value: "充值凭证001" } });
    fireEvent.click(dialog.getByRole("button", { name: "确认登记" }));
    expect(dialog.getByRole("progressbar", { name: "批量充值进度" })).toHaveAttribute("aria-valuenow", "0");
    const partial = { ...confirmed, version: 2, items: [{ ...confirmed.items[0], paid_amount: 176, difference: 0 }, confirmed.items[1]] };
    await act(async () => payments[0](partial));
    expect(dialog.getByRole("progressbar", { name: "批量充值进度" })).toHaveAttribute("aria-valuenow", "50");
    expect(dialog.getByRole("heading", { name: "2 人 · 登记实际充值" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "重算草稿" })).not.toBeInTheDocument();
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
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets?recharge_month=2026-09", expect.objectContaining({ headers: expect.objectContaining({ "X-Meal-Progress-Token": expect.any(String) }) })));
    first.unmount();
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    expect(screen.getByLabelText("计划充值月份")).toHaveValue("2026-09");
    await screen.findByText("员工甲");
  });

  it("历史台账取消导入会删除待确认记录，清空文件且不确认入账", async () => {
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      rows: [], person_total: 180, department_total: 180, departments: [] };
    let records = [history];
    request.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-tickets/imports/9" && options?.method === "DELETE") {
        records = []; return Promise.resolve({ deleted: 9 });
      }
      return Promise.resolve(path === "/api/meal-tickets/imports" ? options?.method === "POST" ? history : records : []);
    });
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    const upload = await screen.findByLabelText("历史充值表");
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.change(upload, { target: { files: [new File(["content"], "历史.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }));
    await screen.findByRole("button", { name: "确认导入原账" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认导入原账" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "查看" })).not.toBeInTheDocument();
    expect(screen.queryByText("历史.xlsx")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/api/meal-tickets/imports/9", { method: "DELETE" });
    expect(screen.queryByRole("button", { name: "读取考勤试算对比" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览导入" })).toBeDisabled();
    expect(upload).toHaveValue("");
    expect(request.mock.calls.some(([path]) => path.endsWith("/confirm"))).toBe(false);
  });

  it("取消导入失败时保留预览与记录，显示错误并允许重试", async () => {
    const history = { id: 9, filename: "上传错了.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      rows: [], person_total: 180, department_total: 180, departments: [] };
    request.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (options?.method === "DELETE") return Promise.reject(new Error("删除失败，请重试"));
      return Promise.resolve(path === "/api/meal-tickets/imports" ? [history] : []);
    });
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败，请重试");
    expect(screen.getByRole("button", { name: "确认导入原账" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回台账列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });

  it("历史导入筛出所有类型的问题，修正后实时移出问题列表", async () => {
    const row = { id: 1, sheet: "员工充值", row: 2, kind: "person", emp_no: "001", name: "正常人员", emp_id: 1,
      dept_name: "生产部", original_dept_name: "生产部", amount: 176, original_amount: 176, original_emp_id: 1,
      error: "", skip: false, correction_reason: "", period_conflict: "", period_confirmed: false };
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      person_total: 176, department_total: 0, departments: [], rows: [row,
        { ...row, id: 2, kind: "department", name: "部门问题", dept_name: "", original_dept_name: "", error: "部门未匹配，请核对部门名称" },
        { ...row, id: 3, emp_no: "003", name: "人员问题", emp_id: null, original_emp_id: null },
        { ...row, id: 4, kind: "department", name: "金额问题", amount: null, original_amount: null },
        { ...row, id: 5, kind: "department", name: "年月问题", period_conflict: "年月不一致" },
        { ...row, id: 6, kind: "department", name: "说明问题", amount: 180 },
        { ...row, id: 7, emp_id: 2, original_emp_id: 2, name: "重复甲" },
        { ...row, id: 8, emp_id: 2, original_emp_id: 2, name: "重复乙" },
        { ...row, id: 10, emp_id: 3, original_emp_id: 3, name: "历史重复" },
        { ...row, id: 11, kind: "department", name: "已跳过问题", dept_name: "旧部门", skip: true }] };
    const previous = { ...history, id: 8, status: "confirmed", rows: [{ ...row, id: 12, emp_id: 3 }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : path === "/api/admin/employees?status=all" ? [1, 2, 3].map(id => ({ id, emp_no: String(id), name: `人员${id}` }))
      : path === "/api/admin/departments" ? [{ dept_name: "生产部" }] : [history, previous]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole("button", { name: "查看" }))[0]);
    expect(screen.getByRole("combobox", { name: "部门 2" })).toHaveValue("__historical__");
    fireEvent.click(screen.getByRole("button", { name: "仅看问题行" }));
    expect(screen.queryByLabelText("部门 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("部门 11")).not.toBeInTheDocument();
    for (const id of [2, 3, 4, 5, 6, 7, 8, 10]) expect(screen.getByLabelText(`部门 ${id}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("部门 2"), { target: { value: "生产部" } });
    expect(screen.getByLabelText("部门 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("更正说明 2"), { target: { value: "部门名称更正" } });
    expect(screen.queryByLabelText("部门 2")).not.toBeInTheDocument();
  });

  it("历史导入多选只处理选中行，筛选后确认仍提交全部行", async () => {
    const row = { id: 1, sheet: "充值", row: 2, kind: "department", emp_no: "", name: "部门一", emp_id: null,
      dept_name: "", original_dept_name: "", amount: 176, original_amount: 176, error: "部门未匹配，请核对部门名称",
      skip: false, correction_reason: "", period_conflict: "", period_confirmed: false };
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      person_total: 0, department_total: 528, departments: [], rows: [row, { ...row, id: 2, name: "部门二" },
        { ...row, id: 3, name: "正常部门", dept_name: "生产部", original_dept_name: "生产部", error: "" }] };
    request.mockImplementation((path: string, options?: { body?: { rows: typeof history.rows } }) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : path === "/api/admin/employees?status=all" ? []
      : path === "/api/admin/departments" ? [{ dept_name: "生产部" }]
      : path.endsWith("/confirm") ? { ...history, status: "confirmed", rows: options!.body!.rows } : [history]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(screen.getByRole("button", { name: "仅看问题行" }));
    fireEvent.click(screen.getByLabelText("全选导入筛选结果"));
    fireEvent.change(screen.getByLabelText("批量设置部门"), { target: { value: "生产部" } });
    fireEvent.change(screen.getByLabelText("批量更正说明"), { target: { value: "旧部门映射到生产部" } });
    fireEvent.click(screen.getByRole("button", { name: "批量设置部门" }));
    expect(screen.queryByLabelText("部门 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量跳过" }));
    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));
    expect(screen.getByLabelText("跳过 1")).toBeChecked();
    expect(screen.getByLabelText("跳过 2")).toBeChecked();
    expect(screen.getByLabelText("跳过 3")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "批量恢复" }));
    expect(screen.getByLabelText("跳过 1")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "仅看问题行" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导入原账" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认导入原账" })).not.toBeInTheDocument());
    expect(request).toHaveBeenCalledWith("/api/meal-tickets/imports/9/confirm", expect.objectContaining({ body: { rows: [
      { ...row, dept_name: "生产部", correction_reason: "旧部门映射到生产部" },
      { ...row, id: 2, name: "部门二", dept_name: "生产部", correction_reason: "旧部门映射到生产部" }, history.rows[2]] } }));
    expect(screen.queryByLabelText("全选导入筛选结果")).not.toBeInTheDocument();
  });

  it("历史导入全选筛选结果可跨页批量处理，不影响筛选外的正常行", async () => {
    const rows = Array.from({ length: 102 }, (_, index) => ({ id: index + 1, sheet: "充值", row: index + 2,
      kind: "department", emp_no: "", name: `部门${index + 1}`, emp_id: null, dept_name: "生产部", amount: index === 101 ? 176 : null,
      original_amount: index === 101 ? 176 : null, original_dept_name: "生产部", error: "", skip: false,
      correction_reason: "", period_conflict: "", period_confirmed: false }));
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      person_total: 0, department_total: 176, departments: [], rows };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : path === "/api/admin/employees?status=all" ? [] : path === "/api/admin/departments" ? [{ dept_name: "生产部" }] : [history]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    fireEvent.click(screen.getByRole("button", { name: "仅看问题行" }));
    fireEvent.click(screen.getByLabelText("全选导入筛选结果"));
    expect(screen.getByText(/已选 101 行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量跳过" }));
    expect(screen.getByText("当前没有需要处理的问题行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));
    const tablePanel = screen.getByLabelText("全选导入筛选结果").closest<HTMLElement>(".legacy-table-panel")!;
    fireEvent.click(within(tablePanel).getByRole("button", { name: "下一页" }));
    expect(screen.getByLabelText("跳过 101")).toBeChecked();
    expect(screen.getByLabelText("跳过 102")).not.toBeChecked();
  });

  it("历史部门可单独填写，不加入系统部门且有效旧部门不算问题", async () => {
    const row = { id: 1, sheet: "充值", row: 2, kind: "department", emp_no: "", name: "历史部门", emp_id: null,
      dept_name: "旧车间", original_dept_name: "旧车间", amount: 176, original_amount: 176,
      error: "部门未匹配，请核对部门名称", skip: false, correction_reason: "", period_conflict: "", period_confirmed: false };
    const history = { id: 9, filename: "历史.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      person_total: 0, department_total: 176, departments: [], rows: [row] };
    request.mockImplementation((path: string, options?: { body?: { rows: typeof history.rows } }) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : path === "/api/admin/employees?status=all" ? [] : path === "/api/admin/departments" ? [{ dept_name: "生产部" }]
      : path.endsWith("/confirm") ? { ...history, status: "confirmed", rows: options!.body!.rows } : [history]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    expect(screen.getByLabelText("历史部门名称 1")).toHaveValue("旧车间");
    fireEvent.click(screen.getByRole("button", { name: "仅看问题行" }));
    expect(screen.queryByLabelText("部门 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));
    fireEvent.change(screen.getByLabelText("历史部门名称 1"), { target: { value: "已撤销车间" } });
    fireEvent.change(screen.getByLabelText("更正说明 1"), { target: { value: "按历史名称登记" } });
    fireEvent.click(screen.getByRole("button", { name: "确认导入原账" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认导入原账" })).not.toBeInTheDocument());
    expect(request).toHaveBeenCalledWith("/api/meal-tickets/imports/9/confirm", expect.objectContaining({ body: { rows: [{ ...row, dept_name: "已撤销车间", correction_reason: "按历史名称登记" }] } }));
    expect(request.mock.calls.some(([path, options]) => path === "/api/admin/departments" && options?.method === "POST")).toBe(false);
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
    fireEvent.click(screen.getByRole("tab", { name: "考勤试算" }));
    fireEvent.click(screen.getByRole("button", { name: "读取考勤试算对比" }));
    await screen.findByText("员工甲");
    expect(screen.getByText("176.00")).toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
  });

  it("历史文件详情一次展示一个页签，已导入原账只读并可返回列表", async () => {
    const history = { id: 9, filename: "八月原账.xlsx", month: "2026-08", recharge_month: "2026-09", status: "confirmed",
      person_total:180,department_total:176,
      departments:[{dept_name:"生产部",person_amount:180,historical_amount:176,difference:4}],
      rows:[{id:1,sheet:"员工充值",row:2,kind:"person",emp_no:"001",name:"员工甲",emp_id:1,
        dept_name:"生产部",amount:180,error:"",skip:false,correction_reason:"已核对",period_conflict:"",period_confirmed:true}]
    };
    request.mockImplementation((path:string) => Promise.resolve(path === "/api/auth/me" ? {role:"admin"}
      : path === "/api/admin/employees?status=all" ? [{id:1,emp_no:"002",name:"员工乙"}]
      : path === "/api/admin/departments" ? [{dept_name:"生产部"}]
      : path.endsWith("/comparison") ? [] : [history]));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button",{name:"查看"}));
    expect(screen.queryByRole("region",{name:"导入记录"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText("历史充值表")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("tab",{name:"人员原账"})).toHaveAttribute("aria-selected","true");
    expect(screen.getByText("员工甲")).toBeInTheDocument();
    expect(screen.getByText("002 员工乙")).toBeInTheDocument();
    expect(screen.queryByLabelText("金额 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab",{name:"部门对账"}));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByText("员工甲")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:/人员原账合计/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab",{name:"考勤试算"}));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"读取考勤试算对比"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"返回台账列表"}));
    expect(screen.getByRole("region",{name:"导入记录"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"查看"}));
    expect(screen.getByRole("tab",{name:"人员原账"})).toHaveAttribute("aria-selected","true");
  });

  it("上传后的待确认原账返回列表仍可查看并保留修改", async () => {
    const history = { id: 9, filename: "新原账.xlsx", month: "2026-08", recharge_month: "2026-09", status: "preview",
      person_total:180,department_total:0,departments:[],
      rows:[{id:1,sheet:"充值",row:2,kind:"person",emp_no:"001",name:"员工甲",emp_id:1,
        dept_name:"生产部",amount:180,error:"",skip:false,correction_reason:"",period_conflict:"",period_confirmed:true}] };
    request.mockImplementation((path:string, options?:{method?:string}) => Promise.resolve(path === "/api/auth/me" ? {role:"admin"}
      : path === "/api/admin/employees?status=all" ? [{id:1,emp_no:"001",name:"员工甲"}]
      : path === "/api/admin/departments" ? [{dept_name:"生产部"}]
      : options?.method === "POST" ? history : []));
    render(<MemoryRouter><MealTicketPage view="history" /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("历史充值表"), {target:{files:[new File(["test"],"新原账.xlsx")]}});
    fireEvent.click(screen.getByRole("button",{name:"预览导入"}));
    fireEvent.change(await screen.findByLabelText("更正说明 1"), {target:{value:"已人工核对"}});
    fireEvent.click(screen.getByRole("button",{name:"返回台账列表"}));
    fireEvent.click(screen.getByRole("button",{name:"查看"}));
    expect(screen.getByLabelText("更正说明 1")).toHaveValue("已人工核对");
  });
});

describe("阶段 4 后续流程", () => {
  it("查询账号在后续页仍可查看已结清实际账目，不能写操作进度", async () => {
    const current = { ...batch, status: "confirmed", items: [{ ...batch.items[0], paid_amount: 176, difference: 0 }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "query" } : current));
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    await screen.findByText("本月账目已结清");
    expect(screen.queryByRole("button", { name: "已完成充值，下一人" })).not.toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path.includes("followup-tasks"))).toBe(false);
  });

  it("三阶段只读导航、取消手动下一步与设备批量入口，扣除提交负金额", async () => {
    const current = { ...batch, status: "confirmed" };
    const queue = { batch_id: 1, batch_version: 1, offset_enabled: true, settings_digest: "s", queue_offset_enabled: true,
      settings_changed: false, baseline_required: false, current_task_key: "a", tasks: [{ key: "a", item_key: "i", emp_no: "00123", name: "任务员工", dept_name: "财务部", kind: "refund", status: "pending", version: 1, amount_cents: 2400, remaining_cents: 2400, allocated_cents: 0 }] };
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" } : path.includes("followup-tasks") ? queue : current));
    render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
    await screen.findByRole("button", { name: "已完成取款，下一人" });
    const flow = within(screen.getByRole("list", { name: "后续补扣流程" }));
    expect(flow.getAllByRole("heading").map(h => h.textContent)).toEqual(["登记补扣", "逐人办理", "核对结果"]);
    expect(flow.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下一步：/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记选中人员充值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "导出充值表（.xls）" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入补扣清单" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "补扣" }));
    fireEvent.change(screen.getByLabelText("补扣方向"), { target: { value: "refund" } });
    fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "核对扣除" } });
    fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets/adjustments", expect.objectContaining({ body: expect.objectContaining({ amount: "-16", reason: "核对扣除" }) })));
  });
});
it("操作声明后的旧账目刷新响应不能覆盖新补扣", async () => {
  let current = { ...batch, status: "confirmed", version: 3 };
  const task = { key: "a", item_key: "i", emp_no: "00123", name: "任务员工", dept_name: "财务部", kind: "recharge", status: "pending", version: 1, amount_cents: 2400, remaining_cents: 2400, allocated_cents: 0 };
  let queue = { batch_id: 1, batch_version: 3, offset_enabled: true, settings_digest: "s", queue_offset_enabled: true, settings_changed: false, baseline_required: false, current_task_key: "a", tasks: [task] };
  let finishOld!: (value: unknown) => void;
  let batchReads = 0;
  let holdQueue = false;
  request.mockImplementation((path: string) => {
    if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
    if (path.includes("/progress")) { queue = { ...queue, batch_version: 4, tasks: [{ ...task, status: "awaiting" }] }; return Promise.resolve(queue); }
    if (path.includes("followup-tasks")) return holdQueue ? new Promise(() => {}) : Promise.resolve(queue);
    if (path === "/api/meal-tickets/adjustments") { current = { ...current, version: 5, items: [{ ...batch.items[0], due_amount: 200, adjustment_amount: 24, difference: 200 }] }; queue = { ...queue, batch_version: 5 }; return Promise.resolve(current); }
    if (path.startsWith("/api/meal-tickets?")) {
      if (++batchReads === 2) return new Promise(resolve => { finishOld = resolve; });
      return Promise.resolve(current);
    }
    return Promise.resolve(current);
  });
  render(<MemoryRouter><MealTicketPage view="payments" /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "已完成充值，下一人" }));
  await waitFor(() => expect(batchReads).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "补扣" }));
  fireEvent.change(screen.getByLabelText("调整金额（元）"), { target: { value: "24" } });
  fireEvent.click(screen.getByRole("button", { name: "线长补卡" }));
  fireEvent.click(screen.getByRole("button", { name: "保存补扣" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "额外补扣" })).not.toBeInTheDocument());
  holdQueue = true;
  await act(async () => finishOld({ ...batch, status: "confirmed", version: 4 }));
  expect(within(screen.getByRole("region", { name: "人员明细" })).getByText("24.00")).toBeInTheDocument();
});

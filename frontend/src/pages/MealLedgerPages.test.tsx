import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MealTicketQueryPage from "./query/MealTicketQueryPage";
import MealLedgerPage from "./MealLedgerPage";
import MealDownloadPage from "./MealDownloadPage";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (p: string) => p }));

describe("菜票查询与台账页面", () => {
  beforeEach(() => request.mockReset());
  it("菜票查询独立展示并按人员类型筛选，不提供发放操作", async () => {
    request.mockResolvedValue({ month: "2026-08", recharge_month: "2026-09", status: "confirmed", items: [
      { id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", is_manager: false, days: 22, base_amount: 176, adjustment_amount: 0, due_amount: 176, paid_amount: 176, difference: 0, adjustments: [], payments: [], error: "" },
      { id: 2, emp_no: "002", name: "经理乙", dept_name: "生产部", is_manager: true, days: 20, base_amount: 160, adjustment_amount: 0, due_amount: 160, paid_amount: 160, difference: 0, adjustments: [], payments: [], error: "" },
    ] });
    render(<MemoryRouter><MealTicketQueryPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.change(screen.getByLabelText("人员类型"), { target: { value: "manager" } });
    expect(screen.queryByText("员工甲")).not.toBeInTheDocument();
    expect(screen.getByText("经理乙")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记实际充值" })).not.toBeInTheDocument();
  });

  it("月末取款登记保存实际金额并展示已登记记录", async () => {
    let rows: object[] = [];
    request.mockImplementation((path: string, options?: { body?: object; method?: string }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (options?.method === "POST") {
        const record = { id: 1, ...options.body, amount: 20, voided: false };
        rows = [record]; return Promise.resolve(record);
      }
      return Promise.resolve(rows);
    });
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    await screen.findByRole("button", { name: "保存记录" });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "访客甲" } });
    const now = new Date();
    fireEvent.change(screen.getByLabelText("处理日期"), { target: { value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-20` } });
    fireEvent.change(screen.getByLabelText("清零取款金额"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(screen.getByText("访客甲")).toBeInTheDocument());
    expect(screen.getByText("20.00")).toBeInTheDocument();
  });

  it("独立查询保留本月不发原因与处理历史", async () => {
    request.mockResolvedValue({ month: "2026-08", recharge_month: "2026-09", status: "confirmed", items: [
      { id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", is_manager: false, days: 22,
        base_amount: 0, adjustment_amount: 0, due_amount: 0, paid_amount: 0, difference: 0, error: "",
        excluded: true, participation_history: [{ excluded: true, reason: "离职不结算", operator: "admin", created_at: "2026-09-01" }],
        adjustments: [], payments: [] },
    ] });
    render(<MemoryRouter><MealTicketQueryPage /></MemoryRouter>);
    await screen.findByText("本月不发：离职不结算");
    fireEvent.click(screen.getByRole("button", { name: "查看明细" }));
    expect(screen.getByText(/2026-09-01.*离职不结算/)).toBeInTheDocument();
  });

  it("只有人员查询权限时下载页不暴露年度及外来台账报表", async () => {
    request.mockResolvedValue({ role: "readonly", page_permissions: { meal_ticket_query: true } });
    render(<MemoryRouter><MealDownloadPage /></MemoryRouter>);
    await screen.findByRole("option", { name: "月度充值记录" });
    expect(screen.queryByRole("option", { name: "全年菜票汇总" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "外来人员领用" })).not.toBeInTheDocument();
  });

  it("历史导入先预览并将修改后的年月与重复确认提交", async () => {
    const preview = { id: 7, kind: "clearance", month: "2026-09", filename: "取款.xlsx", status: "preview", rows: [
      { index: 0, sheet: "8月", row: 4, emp_no: "0001", name: "客人卡", dept_name: "客人", month: "2026-08", date: "2026-08-31", amount: 20, error: "", warning: "疑似重复" },
    ] };
    request.mockImplementation((path: string, options?: { body?: { rows?: unknown[] }; method?: string }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-ledgers/imports/preview") return Promise.resolve(preview);
      if (path === "/api/meal-ledgers/imports/7/confirm") return Promise.resolve({ ...preview, status: "confirmed", rows: options?.body?.rows });
      return Promise.resolve([]);
    });
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    const upload = await screen.findByLabelText("导入文件");
    fireEvent.change(upload, { target: { files: [new File(["test"], "取款.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }));
    await screen.findByText(/预览未入账/);
    expect(request.mock.calls.some(([p]) => String(p).endsWith("/confirm"))).toBe(false);
    fireEvent.change(screen.getByLabelText("第1行月份"), { target: { value: "2025-08" } });
    fireEvent.change(screen.getByLabelText("第1行日期"), { target: { value: "2025-08-15" } });
    fireEvent.click(screen.getByLabelText("确认第1行为另一笔"));
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText("导入已完成");
    const submission = request.mock.calls.find(([p]) => p === "/api/meal-ledgers/imports/7/confirm")?.[1];
    expect(submission.body.rows[0]).toMatchObject({ month: "2025-08", date: "2025-08-15", accept_duplicate: true });
  });

  it("台账只读账号可以查记录但没有登记、导入或作废按钮", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "readonly" } : [
      { id: 1, date: "2026-09-30", emp_no: "001", name: "员工甲", dept_name: "生产部", amount: 20, voided: false },
    ]));
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    await screen.findByText("员工甲");
    expect(screen.queryByRole("button", { name: "保存记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("导入文件")).not.toBeInTheDocument();
  });

  it("作废须填写原因，保存后原记录仍显示作废历史", async () => {
    let record = { id: 1, date: "2026-09-30", emp_no: "001", name: "员工甲", dept_name: "生产部", amount: 20, voided: false, void_reason: "" };
    request.mockImplementation((path: string, options?: { body?: { reason?: string } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-ledgers/records/1/void") {
        record = { ...record, voided: true, void_reason: options?.body?.reason ?? "" };
        return Promise.resolve(record);
      }
      return Promise.resolve([record]);
    });
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "作废" }));
    expect(screen.getByRole("button", { name: "确认作废" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("作废原因"), { target: { value: "重复录入" } });
    fireEvent.click(screen.getByRole("button", { name: "确认作废" }));
    await screen.findByText("已作废：重复录入");
    expect(screen.getByText("员工甲")).toBeInTheDocument();
  });
});

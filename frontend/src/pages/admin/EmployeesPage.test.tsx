import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchEmployees = vi.hoisted(() => vi.fn());
const mockFetchDepartments = vi.hoisted(() => vi.fn());
const mockFetchShifts = vi.hoisted(() => vi.fn());
const mockResign = vi.hoisted(() => vi.fn());
const mockReinstate = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());

vi.mock("../../api/admin", () => ({
  fetchAdminEmployees: mockFetchEmployees,
  fetchAdminDepartments: mockFetchDepartments,
  fetchAdminShifts: mockFetchShifts,
  resignAdminEmployee: mockResign,
  reinstateAdminEmployee: mockReinstate,
  createAdminEmployee: vi.fn(),
  updateAdminEmployee: vi.fn(),
  deleteAdminEmployee: vi.fn(),
  batchAdminEmployees: vi.fn(),
  importAdminEmployees: vi.fn(),
}));
vi.mock("../../components/feedback/Notification", () => ({
  useNotification: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("../../components/feedback/ConfirmDialog", () => ({
  useConfirm: () => mockConfirm,
}));

import EmployeesPage from "./EmployeesPage";

const employees = [
  { id: 1, emp_no: "E100", name: "在职员工", dept_name: "行政部", is_manager: false, resigned_at: null },
  { id: 2, emp_no: "E200", name: "已离职员工", dept_name: "行政部", is_manager: false, resigned_at: "2026-08-31" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmployeesPage 离职功能", () => {
  beforeEach(() => {
    mockFetchEmployees.mockResolvedValue(employees);
    mockFetchDepartments.mockResolvedValue([]);
    mockFetchShifts.mockResolvedValue([]);
    mockConfirm.mockResolvedValue(true);
  });

  it("默认仅显示在职员工，全量拉取数据", async () => {
    render(<EmployeesPage />);
    await waitFor(() => expect(mockFetchEmployees).toHaveBeenCalledWith("all"));

    expect(await screen.findByText("在职员工")).toBeTruthy();
    expect(screen.queryByText("已离职员工")).toBeNull();
  });

  it("筛选已离职后显示离职员工及其离职日期", async () => {
    render(<EmployeesPage />);
    await screen.findByText("在职员工");

    fireEvent.change(screen.getByLabelText("在职状态"), { target: { value: "resigned" } });

    expect(await screen.findByText("已离职员工")).toBeTruthy();
    expect(screen.getByText(/2026-08-31/)).toBeTruthy();
    expect(screen.queryByText("在职员工")).toBeNull();
  });

  it("办理离职弹窗提交工号与日期", async () => {
    mockResign.mockResolvedValue({ status: "ok", employee: employees[0] });
    render(<EmployeesPage />);
    await screen.findByText("在职员工");

    // 顶部"办理离职"按钮与行内按钮同名，取第一个（顶部主入口）
    fireEvent.click(screen.getAllByRole("button", { name: "办理离职" })[0]);
    fireEvent.change(await screen.findByLabelText("离职人员编号"), { target: { value: "E100" } });
    fireEvent.click(screen.getByRole("button", { name: "确认离职" }));

    await waitFor(() =>
      expect(mockResign).toHaveBeenCalledWith(
        expect.objectContaining({ emp_no: "E100", resigned_at: expect.any(String) }),
      ),
    );
  });

  it("已离职行提供恢复在职按钮", async () => {
    mockReinstate.mockResolvedValue({ status: "ok", employee: employees[1] });
    render(<EmployeesPage />);
    await screen.findByText("在职员工");
    fireEvent.change(screen.getByLabelText("在职状态"), { target: { value: "resigned" } });

    fireEvent.click(await screen.findByRole("button", { name: "恢复在职" }));

    await waitFor(() => expect(mockReinstate).toHaveBeenCalledWith(2));
  });
});

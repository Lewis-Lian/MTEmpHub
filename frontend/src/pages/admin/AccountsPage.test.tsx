import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock, notificationMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  notificationMock: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({ apiRequest: apiRequestMock }));
vi.mock("../../api/admin", () => ({
  fetchAdminDepartments: vi.fn(async () => []),
  fetchAdminEmployees: vi.fn(async () => [
    { id: 1, emp_no: "E001", name: "张三", dept_id: null, dept_name: "", is_manager: false },
    { id: 2, emp_no: "E002", name: "李四", dept_id: null, dept_name: "", is_manager: false },
  ]),
}));
vi.mock("../../components/feedback/Notification", () => ({
  useNotification: () => notificationMock,
}));
vi.mock("../../components/query/EmployeePicker", () => ({
  default: () => <div data-testid="employee-picker" />,
}));
vi.mock("../../components/query/DepartmentMultiPicker", () => ({
  default: () => <div data-testid="department-picker" />,
}));

import AccountsPage from "./AccountsPage";

const accountRows = [
  {
    id: 1,
    username: "readonly-user",
    role: "readonly",
    profile_emp_no: "E001",
    profile_name: "张三",
    profile_dept_id: 1,
    profile_department: { id: 1, dept_name: "测试部门" },
    created_at: null,
    page_permissions: { query_home: true },
    emp_ids: [],
    dept_ids: [],
    employees: [],
    departments: [],
  },
  {
    id: 2,
    username: "admin-user",
    role: "admin",
    profile_emp_no: "E002",
    profile_name: "李四",
    profile_dept_id: 1,
    profile_department: { id: 1, dept_name: "测试部门" },
    created_at: null,
    page_permissions: {},
    emp_ids: [],
    dept_ids: [],
    employees: [],
    departments: [],
  },
];

describe("AccountsPage multi-selection", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === "/api/admin/accounts") {
        return accountRows;
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    apiRequestMock.mockReset();
  });

  it("取消当前筛选结果的全选时保留筛选外已选账号", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    const headerCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(headerCheckbox);

    fireEvent.change(screen.getByRole("combobox", { name: "是否管理员账号" }), {
      target: { value: "admin" },
    });
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    const selectedLabel = screen.getByText("已选择 1 个账号");
    const batchToolbar = selectedLabel.closest("section");
    expect(batchToolbar).not.toBeNull();
    expect(within(batchToolbar as HTMLElement).getByText("已选择 1 个账号")).toBeInTheDocument();
    expect(within(batchToolbar as HTMLElement).getByRole("button", { name: "删除账号" })).toBeInTheDocument();
  });

  it("当前筛选结果全选时不会覆盖筛选外已选账号", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    fireEvent.click(screen.getAllByLabelText("选择账号行")[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "是否管理员账号" }), {
      target: { value: "admin" },
    });
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));

    fireEvent.click(screen.getByLabelText("选择当前筛选结果"));

    const selectedLabel = screen.getByText("已选择 2 个账号");
    const batchToolbar = selectedLabel.closest("section");
    expect(within(batchToolbar as HTMLElement).getByText("已选择 2 个账号")).toBeInTheDocument();
  });

  it("批量操作提交当前已选账号 ID", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    fireEvent.click(screen.getAllByLabelText("选择账号行")[1]);
    fireEvent.click(screen.getByRole("button", { name: "删除账号" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/api/admin/users/batch", {
        body: { action: "delete", user_ids: [2] },
        method: "POST",
      });
    });
  });

  it("批量工具条可以一键清除当前选择", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    fireEvent.click(screen.getAllByLabelText("选择账号行")[0]);

    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));

    expect(screen.queryByText(/已选择 \d+ 个账号/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除账号" })).not.toBeInTheDocument();
  });
});

describe("AccountsPage edit modal navigation permissions", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === "/api/admin/accounts") {
        return accountRows;
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    apiRequestMock.mockReset();
  });

  it("打开编辑弹框内联展示功能导航权限且无二级弹框", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    const editButtons = screen.getAllByRole("button", { name: "编辑" });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText("编辑账号")).toBeInTheDocument();
    expect(screen.getByText("功能导航权限")).toBeInTheDocument();
    expect(screen.getByText("通用功能")).toBeInTheDocument();
    expect(screen.getByText("管理人员考勤")).toBeInTheDocument();
    expect(screen.getByText("员工考勤")).toBeInTheDocument();

    // 补齐的权限项也必须存在
    expect(screen.getByText("管理人员部门工时查询")).toBeInTheDocument();
    expect(screen.getByText("个人考勤查询")).toBeInTheDocument();

    // 确认旧的二级弹窗配置按钮已不复存在
    expect(screen.queryByRole("button", { name: /配置导航可见性/ })).not.toBeInTheDocument();
  });

  it("编辑弹框支持全部勾选与清空快捷操作并提交保存", async () => {
    render(<AccountsPage />);

    await screen.findByText("readonly-user");
    const editButtons = screen.getAllByRole("button", { name: "编辑" });
    fireEvent.click(editButtons[0]);

    // 点击全部勾选
    fireEvent.click(screen.getByRole("button", { name: "全部勾选" }));
    expect(screen.getByText("已选 11 / 11 项")).toBeInTheDocument();

    // 点击保存修改
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/api/admin/users/1",
        expect.objectContaining({
          method: "PUT",
          body: expect.objectContaining({
            page_permissions: expect.objectContaining({
              query_home: true,
              manager_query: true,
              manager_overtime_query: true,
              manager_annual_leave_query: true,
              manager_department_hours_query: true,
              employee_dashboard: true,
              individual_attendance: true,
              abnormal_query: true,
              punch_records: true,
              department_hours_query: true,
              summary_download: true,
            }),
          }),
        }),
      );
    });
  });

  it("管理员账号在编辑弹框中显示提示并禁用单项权限勾选", async () => {
    render(<AccountsPage />);

    await screen.findByText("admin-user");
    const editButtons = screen.getAllByRole("button", { name: "编辑" });
    fireEvent.click(editButtons[1]);

    expect(screen.getByText(/系统管理员账号默认拥有系统所有页面的访问和管理权限/)).toBeInTheDocument();
    expect(screen.getByText("全部权限 (管理员)")).toBeInTheDocument();

    // 管理员下不展示快捷全选/清空按钮
    expect(screen.queryByRole("button", { name: "全部勾选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部清空" })).not.toBeInTheDocument();
  });
});

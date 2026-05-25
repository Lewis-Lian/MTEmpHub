import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App smoke regression", () => {
  it("未登录访问受保护页面时会跳转到 /login", async () => {
    window.history.replaceState({}, "", "/employee/home");
    fetchMock.mockImplementation((input) => {
      const path = normalizePath(input);
      if (path === "/api/auth/me") {
        return Promise.resolve(jsonResponse({ error: "Unauthorized" }, { status: 401 }));
      }
      throw new Error(`unexpected request: ${path}`);
    });

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "登录考勤系统" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });

  it("已登录普通用户会落到默认首页并挂载查询页", async () => {
    window.history.replaceState({}, "", "/login");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "管理人员首页概览" })).toBeInTheDocument();
    expect(await screen.findAllByText("查询中心")).not.toHaveLength(0);
    expect(await screen.findAllByRole("button", { name: "退出登录" })).toHaveLength(2);
    expect(await screen.findByText("E001 · 员工甲 · 制造一部")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/employee/home"));
  });

  it("认证后的产品壳子会把模块导航放在左侧而不是顶部", async () => {
    window.history.replaceState({}, "", "/employee/home");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    const { container } = render(<App />);

    await screen.findByRole("heading", { name: "管理人员首页概览" });

    const topNav = container.querySelector(".top-nav");
    const sideNav = container.querySelector(".app-sidebar");

    expect(topNav).not.toBeNull();
    expect(sideNav).not.toBeNull();
    expect(topNav?.querySelector('a[href="/employee/home"]')).toBeNull();
    expect(sideNav?.querySelector('a[href="/employee/home"]')).not.toBeNull();
  });

  it("认证后的产品壳子会让左侧菜单覆盖顶部条的左侧区域", async () => {
    window.history.replaceState({}, "", "/employee/home");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    const { container } = render(<App />);

    await screen.findByRole("heading", { name: "管理人员首页概览" });

    expect(container.querySelector(".app-layout > .app-sidebar")).not.toBeNull();
    expect(container.querySelector(".app-layout > .top-nav")).not.toBeNull();
    expect(container.querySelector(".app-layout > .app-main")).not.toBeNull();
  });

  it("已登录管理员可以挂载后台页面", async () => {
    window.history.replaceState({}, "", "/admin/accounts");
    fetchMock.mockImplementation((input) => mockAdminAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "账号管理" })).toBeInTheDocument();
    expect(await screen.findAllByText("后台管理")).not.toHaveLength(0);
    expect(await screen.findAllByRole("button", { name: "退出登录" })).toHaveLength(2);
    expect(await screen.findByText("系统管理员")).toBeInTheDocument();
    expect(await screen.findByText("A001")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/admin/accounts"));
  });

  it("账套中心会挂载旧版账套工作台", async () => {
    window.history.replaceState({}, "", "/admin/dashboard");
    fetchMock.mockImplementation((input) => mockAdminAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByText("月度账套")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
    expect(screen.getByText("导入考勤原始表")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传原始文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "员工计算" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "管理人员计算" })).toBeInTheDocument();
    expect(screen.getByText("账套导入记录")).toBeInTheDocument();
    expect(screen.getByText("请假单.xlsx")).toBeInTheDocument();
    expect(screen.getByText("uploaded")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/admin/dashboard"));
  });

  it("汇总下载页会挂载旧版多分区结构", async () => {
    window.history.replaceState({}, "", "/employee/summary-download");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "汇总下载" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /选择员工/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "自定义表头" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "下载说明" })).toBeInTheDocument();
    expect(await screen.findAllByText("考勤数据查询工作表")).not.toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe("/employee/summary-download"));
  });

  it("员工考勤数据查询页会挂载旧版筛选栏和结果面板", async () => {
    window.history.replaceState({}, "", "/employee/dashboard");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按员工范围、账套和显示列模式组合查询。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("共 1 条记录")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/employee/dashboard"));
  });

  it("员工异常查询页会严格复用员工考勤数据查询的筛选与结果结构", async () => {
    window.history.replaceState({}, "", "/employee/abnormal-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按员工范围和账套查询异常考勤汇总。")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "人员编号" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("共 1 条记录")).toBeInTheDocument();
    expect(screen.getByText("异常考勤次数")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "人员编号" }));
    expect(screen.queryByRole("button", { name: "人员编号" })).toBeNull();
    expect(screen.getByText("异常考勤次数")).toBeInTheDocument();

    await waitFor(() => expect(window.location.pathname).toBe("/employee/abnormal-query"));
  });

  it("员工打卡数据查询页会挂载统一双栏结构并保留打卡显示选项", async () => {
    window.history.replaceState({}, "", "/employee/punch-records");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("查询员工逐日打卡明细，并支持直接导出 Excel。")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "原始刷卡" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "上下班打卡" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("原始打卡数据")).toBeInTheDocument();
    expect(screen.getByText("异常原因")).toBeInTheDocument();
    expect(screen.getByText("共 1 条记录")).toBeInTheDocument();
  });

  it("员工部门工时页会挂载统一双栏结构", async () => {
    window.history.replaceState({}, "", "/employee/department-hours-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按账套查看员工部门维度的工时汇总。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("部门名称")).toBeInTheDocument();
    expect(screen.getByText("总工时（小时）")).toBeInTheDocument();
    expect(screen.getByText("160")).toBeInTheDocument();
  });

  it("管理人员考勤数据查询页会挂载统一双栏结构并保留模板导出入口", async () => {
    window.history.replaceState({}, "", "/employee/manager-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("查询管理人员月度考勤结果，并支持模板导出。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按模板导出" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "显示实际出勤天数" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("管理人员姓名")).toBeInTheDocument();
    expect(screen.getByText("共 1 条记录")).toBeInTheDocument();
  });

  it("管理人员加班查询页会挂载统一双栏结构", async () => {
    window.history.replaceState({}, "", "/employee/manager-overtime-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按年份查询管理人员月度加班统计。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("前年累积天数")).toBeInTheDocument();
    expect(screen.getByText("部门")).toBeInTheDocument();
    expect(screen.getByText("经理甲")).toBeInTheDocument();
    expect(screen.getByText("共 1 条记录")).toBeInTheDocument();
  });

  it("管理人员年休查询页会挂载统一双栏结构", async () => {
    window.history.replaceState({}, "", "/employee/manager-annual-leave-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按年份查询管理人员月度年休统计。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("剩余年休天数")).toBeInTheDocument();
    expect(screen.getByText("姓名")).toBeInTheDocument();
    expect(screen.getByText("经理甲")).toBeInTheDocument();
    expect(screen.getByText("共 1 条记录")).toBeInTheDocument();
  });

  it("管理人员部门工时页会挂载统一双栏结构", async () => {
    window.history.replaceState({}, "", "/employee/manager-department-hours-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(screen.getByText("按账套统计管理人员部门维度工时。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("部门名称")).toBeInTheDocument();
    expect(screen.getByText("总工时（小时）")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("页签切换后会保留员工考勤查询状态", async () => {
    window.history.replaceState({}, "", "/employee/dashboard");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    await screen.findByRole("heading", { name: "查询条件" });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("共 1 条记录")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("link", { name: /汇总下载/i })[0]);
    expect(await screen.findByRole("heading", { name: "汇总下载" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "员工考勤数据查询" }));

    expect(await screen.findByText("共 1 条记录")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "员工考勤数据查询" })).toHaveAttribute("aria-selected", "true");
  });

  it("管理人员考勤查询页不再显示顶部说明卡片", async () => {
    window.history.replaceState({}, "", "/employee/manager-query");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    const { container } = render(<App />);

    expect(await screen.findByRole("heading", { name: "查询条件" })).toBeInTheDocument();
    expect(container.querySelector(".legacy-page-header")).toBeNull();
    expect(screen.getByText("查询管理人员月度考勤结果，并支持模板导出。")).toBeInTheDocument();
    expect(container.querySelector(".legacy-table-wrap")).not.toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe("/employee/manager-query"));
  });

  it("管理人员考勤修正页不会在缺少查询条件时首屏加载失败", async () => {
    window.history.replaceState({}, "", "/admin/manager-attendance-overrides");
    fetchMock.mockImplementation((input) => mockAdminAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "管理人员考勤修正" })).toBeInTheDocument();
    expect(await screen.findAllByText("等待查询")).not.toHaveLength(0);
    expect(screen.queryByText("管理人员考勤修正加载失败")).not.toBeInTheDocument();
    expect(hasRequestedPath("/api/admin/manager-attendance-overrides")).toBe(false);
  });

  it("管理人员考勤修正页选择月份和人员后可以查询", async () => {
    window.history.replaceState({}, "", "/admin/manager-attendance-overrides");
    fetchMock.mockImplementation((input) => mockAdminAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    await screen.findByRole("heading", { name: "管理人员考勤修正" });
    fireEvent.click(screen.getByRole("button", { name: "选择管理人员" }));
    fireEvent.click(screen.getByLabelText("M001 - 经理甲"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("M001")).toBeInTheDocument();
    expect(await screen.findByText("经理甲")).toBeInTheDocument();
    expect(await screen.findByText("出勤天数：20")).toBeInTheDocument();
    expect(await screen.findByText("经理修正")).toBeInTheDocument();
  });
});

function normalizePath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input, "http://localhost").pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, "http://localhost").pathname;
}

function hasRequestedPath(pathname: string): boolean {
  return fetchMock.mock.calls.some(([input]) => normalizePath(input) === pathname);
}

function mockEmployeeAppResponse(path: string): Promise<Response> {
  switch (path) {
    case "/api/auth/me":
      return Promise.resolve(
        jsonResponse({
          id: 1,
          username: "viewer",
          role: "readonly",
          page_permissions: { employee_dashboard: true },
        }),
      );
    case "/api/query/navigation":
      return Promise.resolve(
        jsonResponse({
          modules: [
            {
              slug: "query",
              label: "查询中心",
              short_label: "查询",
              home_href: "/employee/home",
              entries: [
                {
                  key: "employee_home",
                  label: "首页",
                  href: "/employee/home",
                },
                {
                  key: "employee_dashboard",
                  label: "员工考勤数据查询",
                  href: "/employee/dashboard",
                },
                {
                  key: "employee_abnormal_query",
                  label: "员工异常查询",
                  href: "/employee/abnormal-query",
                },
                {
                  key: "punch_records",
                  label: "员工打卡数据查询",
                  href: "/employee/punch-records",
                },
                {
                  key: "department_hours_query",
                  label: "员工部门工时",
                  href: "/employee/department-hours-query",
                },
                {
                  key: "manager_query",
                  label: "管理人员考勤数据查询",
                  href: "/employee/manager-query",
                },
                {
                  key: "manager_overtime_query",
                  label: "管理人员加班查询",
                  href: "/employee/manager-overtime-query",
                },
                {
                  key: "manager_annual_leave_query",
                  label: "管理人员年休查询",
                  href: "/employee/manager-annual-leave-query",
                },
                {
                  key: "manager_department_hours_query",
                  label: "管理人员部门工时",
                  href: "/employee/manager-department-hours-query",
                },
                {
                  key: "summary_download",
                  label: "汇总下载",
                  href: "/employee/summary-download",
                },
              ],
            },
          ],
        }),
      );
    case "/api/query/bootstrap":
      return Promise.resolve(
        jsonResponse({
          employees: [
            {
              id: 1,
              emp_no: "E001",
              name: "员工甲",
              dept_id: 10,
              dept_name: "制造一部",
              is_manager: true,
            },
          ],
          account_sets: [
            {
              id: 1,
              month: "2026-05",
              name: "2026年5月",
              is_active: true,
            },
          ],
          departments: [
            {
              id: 10,
              dept_no: "D001",
              dept_name: "制造一部",
              parent_id: null,
            },
          ],
        }),
      );
    case "/api/query/home-summary":
      return Promise.resolve(
        jsonResponse({
          has_data: true,
          empty_state: "",
          month: "2026-05",
          account_set_name: "2026年5月",
          support_message: "已加载首页摘要",
          manager: {
            emp_no: "E001",
            name: "员工甲",
            dept_name: "制造一部",
          },
          summary: {
            attendance_days: 20,
          },
        }),
      );
    case "/api/query/employee-dashboard":
      return Promise.resolve(
        jsonResponse({
          headers: ["人员编号", "人员名称", "考勤天数"],
          rows: [["E001", "员工甲", "20"]],
        }),
      );
    case "/api/query/abnormal":
      return Promise.resolve(
        jsonResponse([
          {
            dept_name: "制造一部",
            emp_no: "E001",
            name: "员工甲",
            abnormal_count: 3,
          },
        ]),
      );
    case "/api/query/punch-records":
      return Promise.resolve(
        jsonResponse([
          {
            date: "2026-05-01",
            emp_no: "E001",
            name: "员工甲",
            dept_name: "制造一部",
            raw_punch_data: "08:00,17:30",
            check_in_times: "08:00",
            check_out_times: "17:30",
            punch_count: 2,
            actual_hours: 8,
            late_minutes: 0,
            early_leave_minutes: 0,
            exception_reason: "",
          },
        ]),
      );
    case "/api/query/department-hours":
      return Promise.resolve(
        jsonResponse([
          {
            dept_name: "制造一部",
            total_hours: 160,
          },
        ]),
      );
    case "/api/query/manager-attendance":
      return Promise.resolve(
        jsonResponse({
          headers: ["管理人员姓名", "部门", "实际出勤天数"],
          rows: [["经理甲", "制造一部", "20"]],
        }),
      );
    case "/api/query/manager-overtime":
      return Promise.resolve(
        jsonResponse({
          headers: ["部门", "姓名", "前年累积天数", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "剩余调休天数", "备注"],
          rows: [
            {
              dept_name: "制造一部",
              name: "经理甲",
              prev_dec: "8",
              m1: "2",
              m2: "",
              m3: "",
              m4: "",
              m5: "",
              m6: "",
              m7: "",
              m8: "",
              m9: "",
              m10: "",
              m11: "",
              m12: "",
              remaining: "10",
              remark: "",
            },
          ],
        }),
      );
    case "/api/query/manager-annual-leave":
      return Promise.resolve(
        jsonResponse({
          headers: ["部门", "姓名", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "剩余年休天数", "备注"],
          rows: [
            {
              dept_name: "制造一部",
              name: "经理甲",
              m1: "1",
              m2: "",
              m3: "",
              m4: "",
              m5: "",
              m6: "",
              m7: "",
              m8: "",
              m9: "",
              m10: "",
              m11: "",
              m12: "",
              remaining: "4",
              remark: "",
            },
          ],
        }),
      );
    case "/api/query/manager-department-hours":
      return Promise.resolve(
        jsonResponse([
          {
            dept_name: "制造一部",
            total_hours: 72,
          },
        ]),
      );
    default:
      throw new Error(`unexpected request: ${path}`);
  }
}

function mockAdminAppResponse(path: string): Promise<Response> {
  switch (path) {
    case "/api/auth/me":
      return Promise.resolve(
        jsonResponse({
          id: 9,
          username: "admin",
          role: "admin",
        }),
      );
    case "/api/query/navigation":
      return Promise.resolve(
        jsonResponse({
          modules: [
            {
              slug: "admin",
              label: "后台管理",
              short_label: "后台",
              home_href: "/admin/dashboard",
              entries: [
                {
                  key: "admin_dashboard",
                  label: "后台首页",
                  href: "/admin/dashboard",
                },
                {
                  key: "accounts",
                  label: "账号管理",
                  href: "/admin/accounts",
                },
              ],
            },
          ],
        }),
      );
    case "/api/admin/accounts":
      return Promise.resolve(
        jsonResponse([
          {
            id: 9,
            username: "admin",
            role: "系统管理员",
            profile_emp_no: "A001",
            profile_name: "管理员",
            departments: [{ dept_name: "信息部" }],
          },
        ]),
      );
    case "/api/admin/account-sets":
      return Promise.resolve(
        jsonResponse([
          {
            id: 1,
            month: "2026-05",
            name: "2026-05 账套",
            is_active: true,
            is_locked: false,
            locked_at: null,
            locked_by: null,
            factory_rest_days: 1.5,
            factory_rest_entries: [
              { date: "2026-05-01", period: "full", unit: 1 },
              { date: "2026-05-02", period: "am", unit: 0.5 },
            ],
            monthly_benefit_days: 2,
            created_at: "2026-05-01T08:00:00",
            imports_count: 1,
            pending_count: 1,
            success_count: 0,
            error_count: 0,
            latest_import_at: "2026-05-02T09:00:00",
          },
        ]),
      );
    case "/api/admin/account-sets/1/imports":
      return Promise.resolve(
        jsonResponse([
          {
            id: 1,
            source_filename: "请假单.xlsx",
            stored_path: "/tmp/leave.xlsx",
            file_type: "leave",
            status: "uploaded",
            imported_count: 0,
            error_message: null,
            created_at: "2026-05-02T09:00:00",
          },
        ]),
      );
    case "/api/query/bootstrap":
      return Promise.resolve(
        jsonResponse({
          employees: [
            {
              id: 11,
              emp_no: "M001",
              name: "经理甲",
              dept_id: 10,
              dept_name: "信息部",
              is_manager: true,
            },
            {
              id: 12,
              emp_no: "E001",
              name: "员工甲",
              dept_id: 10,
              dept_name: "信息部",
              is_manager: false,
            },
          ],
          account_sets: [
            {
              id: 1,
              month: "2026-05",
              name: "2026年5月",
              is_active: true,
            },
          ],
          departments: [
            {
              id: 10,
              dept_no: "D001",
              dept_name: "信息部",
              parent_id: null,
            },
          ],
        }),
      );
    case "/api/admin/manager-attendance-overrides":
      return Promise.resolve(
        jsonResponse({
          month: "2026-05",
          rows: [
            {
              employee: {
                id: 11,
                emp_no: "M001",
                name: "经理甲",
                dept_id: 10,
                dept_name: "信息部",
                is_manager: true,
              },
              automatic: {
                attendance_days: 20,
                injury_days: null,
                business_trip_days: null,
                marriage_days: null,
                funeral_days: null,
                late_early_minutes: null,
              },
              override: {
                attendance_days: 20,
                injury_days: 1,
                business_trip_days: null,
                marriage_days: null,
                funeral_days: null,
                late_early_minutes: 5,
                remark: "经理修正",
                updated_at: "2026-05-10T09:00:00",
              },
              applied: {
                attendance_days: 20,
                injury_days: 1,
                business_trip_days: null,
                marriage_days: null,
                funeral_days: null,
                late_early_minutes: 5,
              },
            },
          ],
        }),
      );
    default:
      throw new Error(`unexpected request: ${path}`);
  }
}

function jsonResponse(body: unknown, init: MockResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

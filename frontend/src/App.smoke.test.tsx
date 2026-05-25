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

  it("汇总下载页会挂载旧版多分区结构", async () => {
    window.history.replaceState({}, "", "/employee/summary-download");
    fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "汇总下载" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "自定义表头" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "下载说明" })).toBeInTheDocument();
    expect(await screen.findAllByText("考勤数据查询工作表")).not.toHaveLength(0);
    await waitFor(() => expect(window.location.pathname).toBe("/employee/summary-download"));
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
    const employeeSelect = screen.getByRole("listbox");
    const targetOption = screen.getByRole("option", { name: "M001 - 经理甲 / 信息部" }) as HTMLOptionElement;
    targetOption.selected = true;
    fireEvent.change(employeeSelect);
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

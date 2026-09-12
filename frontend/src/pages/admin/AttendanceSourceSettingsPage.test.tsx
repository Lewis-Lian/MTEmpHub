import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, notificationMock, authMock } = vi.hoisted(() => ({
  apiMock: {
    fetchAttendanceSettings: vi.fn(),
    saveAttendanceSettings: vi.fn(),
    fetchAccountSets: vi.fn(),
    syncManagerAttendance: vi.fn(),
    managerAttendanceUnmatchedCsvUrl: vi.fn((id: number) => `https://api.example.test/api/admin/manager-attendance/sync-runs/${id}/unmatched.csv`),
    testAttendanceConnection: vi.fn(),
    fetchManagerAttendanceSyncHistory: vi.fn(async () => []),
    testCardDbConnection: vi.fn(),
    syncEmployeeAttendance: vi.fn(),
    fetchEmployeeAttendanceSyncHistory: vi.fn(async () => []),
    fetchSyncProgress: vi.fn(async () => ({ account_set_id: 7, sync_type: "employee", status: "idle", percent: 0, stage: "" })),
    cardAttendanceUnmatchedCsvUrl: vi.fn((id: number) => `https://api.example.test/api/admin/employee-attendance/sync-runs/${id}/unmatched.csv`),
  },
  notificationMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  authMock: { fetchMe: vi.fn(async () => ({ id: 1, username: "admin", role: "admin" })) },
}));

vi.mock("../../api/admin", () => apiMock);
vi.mock("../../api/auth", () => authMock);
vi.mock("../../components/feedback/Notification", () => ({ useNotification: () => notificationMock }));
vi.mock("../../components/query/QueryTable", () => ({ default: ({ rows }: { rows: unknown[][] }) => <table><tbody>{rows.map((row, i) => <tr key={i}><td>{row.join(" ")}</td></tr>)}</tbody></table> }));

import AttendanceSourceSettingsPage from "./AttendanceSourceSettingsPage";

describe("AttendanceSourceSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMock.fetchMe.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
  });
  beforeEach(() => vi.resetAllMocks());

  function setup(configure?: () => void) {
    authMock.fetchMe.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
    apiMock.fetchAttendanceSettings.mockResolvedValue({
      manager_attendance_source: "local",
      dingtalk_configured: true,
      employee_attendance_source: "local",
      card_db: {},
      card_db_configured: false,
    });
    apiMock.fetchAccountSets.mockResolvedValue([{ id: 7, month: "2026-08", name: "2026年08月", is_active: true }, { id: 8, month: "2026-09", name: "2026年09月", is_active: false }]);
    apiMock.saveAttendanceSettings.mockResolvedValue({ manager_attendance_source: "dingtalk", dingtalk_configured: true, employee_attendance_source: "local", card_db: {}, card_db_configured: false });
    apiMock.testAttendanceConnection.mockResolvedValue({ ok: true, message: "钉钉连接成功", dingtalk_configured: true });
    apiMock.testCardDbConnection.mockResolvedValue({ ok: true, message: "考勤机数据库连接成功：SQL Server 2012" });
    apiMock.syncManagerAttendance.mockResolvedValue({ status: "partial", read_count: 10, imported_count: 8, unmatched_count: 2, unmatched: [{ emp_no: "X1", name: "未匹配", record_date: "2026-08-01" }], sync_run_id: 9, message: "存在未匹配记录" });
    apiMock.syncEmployeeAttendance.mockResolvedValue({ status: "partial", read_count: 20, imported_count: 18, unmatched_count: 2, unmatched: [{ emp_no: "C1", name: "外部人员", record_date: "2026-08-02" }], sync_run_id: 11, message: "存在未匹配记录" });
    configure?.();
    render(<AttendanceSourceSettingsPage />);
  }

  it("loads settings with the admin session and shows source switch without echoing secrets", async () => {
    setup();
    expect(await screen.findByText("钉钉凭证已配置")).toBeInTheDocument();
    expect(apiMock.fetchAttendanceSettings).toHaveBeenCalledWith();
    expect(screen.queryByText("setup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(apiMock.testAttendanceConnection).toHaveBeenCalledWith());
    await waitFor(() => expect(notificationMock.success).toHaveBeenCalledWith("钉钉连接成功"));
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(apiMock.saveAttendanceSettings).toHaveBeenCalledWith("dingtalk"));
  });

  it("syncs selected account set and renders partial unmatched records", async () => {
    setup();
    await screen.findAllByText("2026年08月");
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(apiMock.saveAttendanceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "同步管理人员考勤" }));
    expect(await screen.findByText("同步完成，但有 2 条未匹配记录")).toBeInTheDocument();
    expect(screen.getByText(/X1 未匹配 2026-08-01/)).toBeInTheDocument();
    expect(apiMock.syncManagerAttendance).toHaveBeenCalledWith(7);
    expect(screen.getByRole("link", { name: "下载未匹配 CSV" })).toHaveAttribute("href", "https://api.example.test/api/admin/manager-attendance/sync-runs/9/unmatched.csv");
  });

  it("shows empty history and hides admin controls when no admin session exists", async () => {
    setup(() => authMock.fetchMe.mockRejectedValue(new Error("未登录")));
    await waitFor(() => expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "同步管理人员考勤" })).not.toBeInTheDocument();
  });

  it("reports a connection test failure without exposing credentials", async () => {
    setup();
    apiMock.testAttendanceConnection.mockRejectedValue(new Error("钉钉连接失败 DINGTALK_CLIENT_SECRET=super-secret"));
    await screen.findByText("钉钉凭证已配置");
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(notificationMock.error).toHaveBeenCalledWith("连接测试失败，请检查钉钉配置"));
    expect(screen.queryByText("super-secret")).not.toBeInTheDocument();
  });

  it("shows an explicit empty history state for administrators", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("暂无同步记录。")).toBeInTheDocument());
  });

  it("renders the latest non-empty history result and ordinary history errors", async () => {
    apiMock.fetchManagerAttendanceSyncHistory.mockResolvedValueOnce([{ status: "success", read_count: 4, imported_count: 4, unmatched_count: 0, unmatched: [], sync_run_id: 12, message: "ok" }] as never);
    setup();
    await waitFor(() => expect(screen.getByText("同步成功")).toBeInTheDocument());
    cleanup();
    apiMock.fetchManagerAttendanceSyncHistory.mockRejectedValueOnce(new Error("历史服务不可用"));
    setup();
    await waitFor(() => expect(screen.getByText("历史服务不可用")).toBeInTheDocument());
  });

  it("shows a settings load failure message", async () => {
    setup(() => apiMock.fetchAttendanceSettings.mockRejectedValue(new Error("考勤设置服务不可用")));
    await waitFor(() => expect(screen.getByText("考勤设置服务不可用")).toBeInTheDocument());
  });

  it("keeps the page rendered when the admin account list fails", async () => {
    setup(() => apiMock.fetchAccountSets.mockRejectedValue(Object.assign(new Error("管理员会话已过期"), { status: 401 })));
    await waitFor(() => expect(screen.getByText("管理员会话已过期")).toBeInTheDocument());
    expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同步管理人员考勤" })).not.toBeInTheDocument();
  });

  it("keeps admin sync controls when the account list fails with a server error", async () => {
    setup(() => apiMock.fetchAccountSets.mockRejectedValue(Object.assign(new Error("账套服务暂时不可用"), { status: 500 })));
    await waitFor(() => expect(screen.getByText("账套服务暂时不可用")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "同步管理人员考勤" })).toBeInTheDocument();
    expect(screen.queryByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).not.toBeInTheDocument();
  });

  it("hides admin controls when sync history returns an admin expiry", async () => {
    setup(() => apiMock.fetchManagerAttendanceSyncHistory.mockRejectedValue(Object.assign(new Error("登录已过期"), { status: 403 })));
    await waitFor(() => expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument());
    expect(screen.getByText("更多设置")).toBeInTheDocument();
  });

  it("shows history loading and ignores an older account response after switching", async () => {
    let resolveOld!: (value: any[]) => void;
    const oldHistory = new Promise<any[]>((resolve) => { resolveOld = resolve; });
    const newResult = { status: "success", read_count: 3, imported_count: 3, unmatched_count: 0, unmatched: [], sync_run_id: 21, message: "new" };
    apiMock.fetchManagerAttendanceSyncHistory.mockImplementation(((id: number) => id === 7 ? oldHistory : Promise.resolve([newResult])) as never);
    setup();
    await waitFor(() => expect(screen.getByText("正在加载最近同步记录...")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "账套：" }), { target: { value: "8" } });
    resolveOld([]);
    await waitFor(() => expect(screen.getByText("同步成功")).toBeInTheDocument());
    expect(apiMock.fetchManagerAttendanceSyncHistory).toHaveBeenCalledWith(8);
    expect(screen.queryByText("正在加载最近同步记录...")).not.toBeInTheDocument();
  });

  it("keeps the page rendered when a sync request expires the admin cookie", async () => {
    setup();
    apiMock.syncManagerAttendance.mockRejectedValue(Object.assign(new Error("admin expired"), { status: 401 }));
    await screen.findByText("钉钉凭证已配置");
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "同步管理人员考勤" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "同步管理人员考勤" }));
    await waitFor(() => expect(notificationMock.warning).toHaveBeenCalledWith("管理员登录已过期，请重新登录"));
    expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同步管理人员考勤" })).not.toBeInTheDocument();
  });

  it("shows the login-expired hint when the connection test session expires", async () => {
    setup();
    await screen.findByText("钉钉凭证已配置");
    apiMock.testAttendanceConnection.mockRejectedValue(Object.assign(new Error("登录状态已失效"), { status: 401 }));
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(notificationMock.warning).toHaveBeenCalledWith("管理员登录已过期，请重新登录"));
    expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument();
  });

  it("does not call admin account or history APIs for a non-admin session", async () => {
    setup(() => authMock.fetchMe.mockRejectedValue(new Error("未登录")));
    await waitFor(() => expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument());
    expect(apiMock.fetchAccountSets).not.toHaveBeenCalled();
    expect(apiMock.fetchManagerAttendanceSyncHistory).not.toHaveBeenCalled();
  });

  it("does not let same-account history arriving after sync overwrite the sync result", async () => {
    let resolveHistory!: (value: any[]) => void;
    const delayed = new Promise<any[]>((resolve) => { resolveHistory = resolve; });
    setup(() => apiMock.fetchManagerAttendanceSyncHistory.mockReturnValue(delayed as never));
    await screen.findByText("钉钉凭证已配置");
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "同步管理人员考勤" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "同步管理人员考勤" }));
    await screen.findByText("同步完成，但有 2 条未匹配记录");
    resolveHistory([{ status: "success", read_count: 99, imported_count: 99, unmatched_count: 0, unmatched: [], sync_run_id: 100, message: "old" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("同步完成，但有 2 条未匹配记录")).toBeInTheDocument();
    expect(screen.queryByText("读取 99 条，导入 99 条，未匹配 0 条")).not.toBeInTheDocument();
  });

  it("shows a zero-account state", async () => {
    setup(() => apiMock.fetchAccountSets.mockResolvedValue([]));
    await waitFor(() => expect(screen.getByText("暂无可用账套。")).toBeInTheDocument());
  });

  it("renders the employee panel above the manager panel and switches the employee source", async () => {
    setup();
    await screen.findByText("钉钉凭证已配置");
    const employeeKicker = screen.getByText("员工考勤");
    const managerKicker = screen.getByText("管理人员考勤");
    expect(employeeKicker.compareDocumentPosition(managerKicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "数据库同步" }));
    await waitFor(() =>
      expect(apiMock.saveAttendanceSettings).toHaveBeenCalledWith("local", { employee_attendance_source: "card_db" }),
    );
    expect(notificationMock.success).toHaveBeenCalledWith("员工考勤数据源已保存");
  });

  it("saves the card database form and tests the connection with the typed values", async () => {
    setup();
    await screen.findByText("考勤机数据库未配置");
    fireEvent.change(screen.getByLabelText("考勤机地址"), { target: { value: "192.0.2.10" } });
    fireEvent.change(screen.getByLabelText("考勤机端口"), { target: { value: "1433" } });
    fireEvent.change(screen.getByLabelText("考勤机库名"), { target: { value: "STCard_Test" } });
    fireEvent.change(screen.getByLabelText("考勤机账号"), { target: { value: "card_user" } });
    fireEvent.change(screen.getByLabelText("考勤机密码"), { target: { value: "card-pass-123" } });

    fireEvent.click(screen.getByRole("button", { name: "保存连接参数" }));
    await waitFor(() =>
      expect(apiMock.saveAttendanceSettings).toHaveBeenCalledWith("local", {
        card_db: { host: "192.0.2.10", port: "1433", database: "STCard_Test", user: "card_user", password: "card-pass-123" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "考勤机连接测试" }));
    await waitFor(() =>
      expect(apiMock.testCardDbConnection).toHaveBeenCalledWith({
        host: "192.0.2.10", port: "1433", database: "STCard_Test", user: "card_user", password: "card-pass-123",
      }),
    );
    await waitFor(() => expect(notificationMock.success).toHaveBeenCalled());
  });

  it("surfaces the server failure reason instead of the raw 502 status text", async () => {
    setup(() =>
      apiMock.fetchAttendanceSettings.mockResolvedValue({
        manager_attendance_source: "local",
        dingtalk_configured: true,
        employee_attendance_source: "card_db",
        card_db: {},
        card_db_configured: true,
      }),
    );
    await screen.findByText("考勤机数据库已配置");

    apiMock.testCardDbConnection.mockRejectedValue(Object.assign(new Error("Bad Gateway"), {
      status: 502,
      details: { ok: false, message: "考勤机数据库连接失败，请检查网络和数据库配置后重试" },
    }));
    fireEvent.click(screen.getByRole("button", { name: "考勤机连接测试" }));
    await waitFor(() =>
      expect(notificationMock.error).toHaveBeenCalledWith("考勤机数据库连接失败，请检查网络和数据库配置后重试"),
    );
    expect(notificationMock.error).not.toHaveBeenCalledWith("Bad Gateway");

    apiMock.syncEmployeeAttendance.mockRejectedValue(Object.assign(new Error("Bad Gateway"), {
      status: 502,
      details: { status: "failed", message: "考勤机数据库未配置，请先在更多设置中填写连接参数" },
    }));
    fireEvent.click(screen.getByRole("button", { name: "同步员工考勤" }));
    await waitFor(() =>
      expect(notificationMock.error).toHaveBeenCalledWith("考勤机数据库未配置，请先在更多设置中填写连接参数"),
    );
    expect(notificationMock.error).not.toHaveBeenCalledWith("Bad Gateway");
  });

  it("syncs employee attendance for the selected account set and renders unmatched records", async () => {
    setup(() =>
      apiMock.fetchAttendanceSettings.mockResolvedValue({
        manager_attendance_source: "local",
        dingtalk_configured: true,
        employee_attendance_source: "card_db",
        card_db: { host: "192.0.2.10" },
        card_db_configured: true,
      }),
    );
    await screen.findByText("考勤机数据库已配置");
    fireEvent.click(screen.getByRole("button", { name: "同步员工考勤" }));
    expect(await screen.findByText("同步完成，但有 2 条未匹配记录")).toBeInTheDocument();
    expect(screen.getByText(/C1 外部人员 2026-08-02/)).toBeInTheDocument();
    expect(apiMock.syncEmployeeAttendance).toHaveBeenCalledWith(7);
    expect(screen.getByRole("link", { name: "下载未匹配 CSV" })).toHaveAttribute(
      "href",
      "https://api.example.test/api/admin/employee-attendance/sync-runs/11/unmatched.csv",
    );
  });

  it("renders a real progress bar while sync is in flight and updates with polled progress", async () => {
    let resolveSync!: (value: any) => void;
    const pendingSync = new Promise((resolve) => { resolveSync = resolve; });
    apiMock.fetchSyncProgress.mockResolvedValue({
      account_set_id: 7,
      sync_type: "employee",
      status: "running",
      percent: 48,
      stage: "正在匹配员工打卡流水 (1200 / 2500)...",
    });

    setup(() => {
      apiMock.fetchAttendanceSettings.mockResolvedValue({
        manager_attendance_source: "local",
        dingtalk_configured: true,
        employee_attendance_source: "card_db",
        card_db: { host: "192.0.2.10" },
        card_db_configured: true,
      });
      apiMock.syncEmployeeAttendance.mockReturnValue(pendingSync as never);
    });
    await screen.findByText("考勤机数据库已配置");
    fireEvent.click(screen.getByRole("button", { name: "同步员工考勤" }));

    // 进度条即时渲染
    const progressBar = await screen.findByRole("progressbar", { name: "员工考勤同步进度" });
    expect(progressBar).toBeInTheDocument();

    // 轮询更新真实阶段与百分比
    await waitFor(() => {
      expect(screen.getByText("正在匹配员工打卡流水 (1200 / 2500)...")).toBeInTheDocument();
      expect(screen.getByText("48%")).toBeInTheDocument();
    });

    // 同步完成响应
    resolveSync({ status: "success", read_count: 50, imported_count: 50, unmatched_count: 0, unmatched: [], sync_run_id: 15, message: "ok" });
    await waitFor(() => expect(screen.getByText("同步成功")).toBeInTheDocument());
  });
});

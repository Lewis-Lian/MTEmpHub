import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, notificationMock, authMock } = vi.hoisted(() => ({
  apiMock: {
    getDatabaseSettings: vi.fn(),
    fetchAttendanceSettings: vi.fn(),
    saveAttendanceSettings: vi.fn(),
    fetchAccountSets: vi.fn(),
    syncManagerAttendance: vi.fn(),
    managerAttendanceUnmatchedCsvUrl: vi.fn((id: number) => `https://api.example.test/api/admin/manager-attendance/sync-runs/${id}/unmatched.csv`),
    testAttendanceConnection: vi.fn(),
    fetchManagerAttendanceSyncHistory: vi.fn(async () => []),
  },
  notificationMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  authMock: { fetchMe: vi.fn(async () => ({ id: 1, username: "admin", role: "admin" })) },
}));

vi.mock("../../api/admin", () => ({
  ...apiMock,
  saveDatabaseSettings: vi.fn(),
  testDatabaseConnection: vi.fn(),
  migrateDatabase: vi.fn(),
  migrateToSqliteDatabase: vi.fn(),
  switchToSqlite: vi.fn(),
  switchToMysql: vi.fn(),
}));
vi.mock("../../api/auth", () => authMock);
vi.mock("../../components/feedback/Notification", () => ({ useNotification: () => notificationMock }));
vi.mock("../../components/feedback/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("../../components/query/QueryTable", () => ({ default: ({ rows }: { rows: unknown[][] }) => <table><tbody>{rows.map((row, i) => <tr key={i}><td>{row.join(" ")}</td></tr>)}</tbody></table> }));
vi.mock("../../components/feedback/LoadingState", () => ({ default: () => <div>加载中</div> }));
vi.mock("../../components/feedback/ErrorState", () => ({ default: ({ description }: { description: string }) => <div>{description}</div> }));
vi.mock("react-router-dom", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import DatabaseSettingsPage from "./DatabaseSettingsPage";

describe("DatabaseSettingsPage attendance source", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMock.fetchMe.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
  });
  beforeEach(() => vi.resetAllMocks());

  function setup(configure?: () => void) {
    authMock.fetchMe.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
    apiMock.getDatabaseSettings.mockResolvedValue({ current: [], mysql_config: {} });
    apiMock.fetchAttendanceSettings.mockResolvedValue({ manager_attendance_source: "local", dingtalk_configured: true });
    apiMock.fetchAccountSets.mockResolvedValue([{ id: 7, month: "2026-08", name: "2026年08月", is_active: true }, { id: 8, month: "2026-09", name: "2026年09月", is_active: false }]);
    apiMock.saveAttendanceSettings.mockResolvedValue({ manager_attendance_source: "dingtalk", dingtalk_configured: true });
    apiMock.testAttendanceConnection.mockResolvedValue({ ok: true, message: "钉钉连接成功", dingtalk_configured: true });
    apiMock.syncManagerAttendance.mockResolvedValue({ status: "partial", read_count: 10, imported_count: 8, unmatched_count: 2, unmatched: [{ emp_no: "X1", name: "未匹配", record_date: "2026-08-01" }], sync_run_id: 9, message: "存在未匹配记录" });
    configure?.();
    render(<DatabaseSettingsPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入向导密码"), { target: { value: "setup" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁并进入" }));
  }

  it("shows source switch and connection status without echoing secrets", async () => {
    setup();
    expect(await screen.findByText("考勤数据源")).toBeInTheDocument();
    expect(screen.getByText("钉钉凭证已配置")).toBeInTheDocument();
    expect(screen.queryByText("setup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(apiMock.testAttendanceConnection).toHaveBeenCalledWith("setup"));
    await waitFor(() => expect(notificationMock.success).toHaveBeenCalledWith("钉钉连接成功"));
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(apiMock.saveAttendanceSettings).toHaveBeenCalledWith("dingtalk", "setup"));
  });

  it("syncs selected account set and renders partial unmatched records", async () => {
    setup();
    await screen.findByText("2026年08月");
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
    await screen.findByText("考勤数据源");
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

  it("keeps database settings unlocked when the admin account list fails", async () => {
    setup(() => apiMock.fetchAccountSets.mockRejectedValue(Object.assign(new Error("管理员会话已过期"), { status: 401 })));
    await waitFor(() => expect(screen.getByText("管理员会话已过期")).toBeInTheDocument());
    expect(screen.getByText("系统部署向导：数据库设置")).toBeInTheDocument();
    expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同步管理人员考勤" })).not.toBeInTheDocument();
  });

  it("keeps admin sync controls when the account list fails with a server error", async () => {
    setup(() => apiMock.fetchAccountSets.mockRejectedValue(Object.assign(new Error("账套服务暂时不可用"), { status: 500 })));
    await waitFor(() => expect(screen.getByText("账套服务暂时不可用")).toBeInTheDocument());
    expect(screen.getByText("系统部署向导：数据库设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "同步管理人员考勤" })).toBeInTheDocument();
    expect(screen.queryByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).not.toBeInTheDocument();
  });

  it("keeps setup unlock when sync history returns an admin expiry", async () => {
    setup(() => apiMock.fetchManagerAttendanceSyncHistory.mockRejectedValue(Object.assign(new Error("登录已过期"), { status: 403 })));
    await waitFor(() => expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument());
    expect(screen.getByText("系统部署向导：数据库设置")).toBeInTheDocument();
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

  it("keeps the unlocked page when a sync request expires the admin cookie", async () => {
    setup();
    apiMock.syncManagerAttendance.mockRejectedValue(Object.assign(new Error("admin expired"), { status: 401 }));
    await screen.findByText("考勤数据源");
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "同步管理人员考勤" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "同步管理人员考勤" }));
    await waitFor(() => expect(notificationMock.warning).toHaveBeenCalledWith("管理员登录已过期，请重新登录后使用同步功能"));
    expect(screen.getByText("系统部署向导：数据库设置")).toBeInTheDocument();
    expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同步管理人员考勤" })).not.toBeInTheDocument();
  });

  it("does not call admin account or history APIs for a public setup session", async () => {
    setup(() => authMock.fetchMe.mockRejectedValue(new Error("未登录")));
    await waitFor(() => expect(screen.getByText("管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。")).toBeInTheDocument());
    expect(apiMock.fetchAccountSets).not.toHaveBeenCalled();
    expect(apiMock.fetchManagerAttendanceSyncHistory).not.toHaveBeenCalled();
  });

  it("does not let same-account history arriving after sync overwrite the sync result", async () => {
    let resolveHistory!: (value: any[]) => void;
    const delayed = new Promise<any[]>((resolve) => { resolveHistory = resolve; });
    setup(() => apiMock.fetchManagerAttendanceSyncHistory.mockReturnValue(delayed as never));
    await screen.findByText("考勤数据源");
    fireEvent.click(screen.getByRole("button", { name: "钉钉" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "同步管理人员考勤" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "同步管理人员考勤" }));
    await screen.findByText("同步完成，但有 2 条未匹配记录");
    resolveHistory([{ status: "success", read_count: 99, imported_count: 99, unmatched_count: 0, unmatched: [], sync_run_id: 100, message: "old" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("同步完成，但有 2 条未匹配记录")).toBeInTheDocument();
    expect(screen.queryByText("读取 99 条，导入 99 条，未匹配 0 条")).not.toBeInTheDocument();
  });

  it("shows a zero-account state while retaining database controls", async () => {
    setup(() => apiMock.fetchAccountSets.mockResolvedValue([]));
    await waitFor(() => expect(screen.getByText("暂无可用账套。")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂存配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到 MySQL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切回 SQLite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出至 MySQL" })).toBeInTheDocument();
  });

  it("returns to the setup unlock form when the connection test setup credential expires", async () => {
    setup();
    await screen.findByText("考勤数据源");
    apiMock.testAttendanceConnection.mockRejectedValue(Object.assign(new Error("向导访问密码不正确"), { status: 401 }));
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(screen.getByPlaceholderText("请输入向导密码")).toBeInTheDocument());
    expect(screen.queryByText("考勤数据源")).not.toBeInTheDocument();
  });
});

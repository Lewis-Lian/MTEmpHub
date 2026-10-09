import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceSourceSettingsPage from "./AttendanceSourceSettingsPage";
import { NotificationProvider } from "../../components/feedback/Notification";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
const settings = {
  manager_attendance_source: "local", employee_attendance_source: "card_db", dingtalk_configured: false,
  card_db: { host: "192.0.2.10", port: 1433, database: "STCard_Test", user: "reader" },
  card_db_configured: true, meal_ticket_db_enabled: false,
};

describe("共享数据库用途", () => {
  beforeEach(() => request.mockReset());
  it("菜票开关共用连接，切换后不改变考勤来源和已填连接参数", async () => {
    let current = settings;
    request.mockImplementation((path: string, options?: { body?: { meal_ticket_db_enabled?: boolean } }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/admin/account-sets") return Promise.resolve([]);
      if (options?.body?.meal_ticket_db_enabled !== undefined) {
        expect(options.body).toEqual({ manager_attendance_source: "local", meal_ticket_db_enabled: !current.meal_ticket_db_enabled });
        current = { ...current, meal_ticket_db_enabled: options.body.meal_ticket_db_enabled };
      }
      return Promise.resolve(current);
    });
    render(<NotificationProvider><AttendanceSourceSettingsPage /></NotificationProvider>);
    const toggle = await screen.findByRole("switch", { name: "菜票数据库核对" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const switches = screen.getByRole("region", { name: "同步用途开关" });
    expect(within(switches).getByRole("heading", { name: "菜票充值与核对" })).toBeInTheDocument();
    expect(within(switches).getAllByRole("switch")).toHaveLength(3);
    const database = screen.getByRole("region", { name: "共享数据库设置" });
    expect(switches.compareDocumentPosition(database) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(database).queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByLabelText("考勤机地址")).toHaveValue("192.0.2.10");
    expect(screen.getByRole("switch", { name: "员工数据库同步" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });
  it("保存失败时保持菜票开关原状态并提示原因", async () => {
    request.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/admin/account-sets") return Promise.resolve([]);
      if (options?.method === "PUT") return Promise.reject(new Error("保存连接用途失败"));
      return Promise.resolve(settings);
    });
    render(<NotificationProvider><AttendanceSourceSettingsPage /></NotificationProvider>);
    const toggle = await screen.findByRole("switch", { name: "菜票数据库核对" });
    fireEvent.click(toggle);
    expect(await screen.findByText("保存连接用途失败")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

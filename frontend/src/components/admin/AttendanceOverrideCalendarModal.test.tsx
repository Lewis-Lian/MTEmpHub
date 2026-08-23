import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchCalendar = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());
const mockClear = vi.hoisted(() => vi.fn());

vi.mock("../../api/admin", () => ({
  fetchAdminDailyOverrideCalendar: mockFetchCalendar,
  saveAdminDailyOverride: mockSave,
  clearAdminDailyOverride: mockClear,
}));

import AttendanceOverrideCalendarModal from "./AttendanceOverrideCalendarModal";
import { NotificationProvider } from "../feedback/Notification";
import type { AttendanceCalendarData } from "../../types/query";

const EMPLOYEE = { id: 7, emp_no: "E001", name: "员工甲" };

function calendarData(overrides: Record<string, unknown> = {}): AttendanceCalendarData {
  return {
    employee: { ...EMPLOYEE, dept_name: "制造一部" },
    month: "2026-07",
    days: [
      {
        date: "2026-07-01",
        check_in_times: ["08:00"],
        check_out_times: ["17:00"],
        punch_count: 2,
        actual_hours: 8,
        late_minutes: 0,
        early_leave_minutes: 0,
        is_half_day: false,
        exception_reason: "",
        override: (overrides["2026-07-01"] as never) ?? null,
      },
      {
        date: "2026-07-15",
        check_in_times: [],
        check_out_times: [],
        punch_count: 0,
        actual_hours: 0,
        late_minutes: 0,
        early_leave_minutes: 0,
        is_half_day: false,
        exception_reason: "",
        override: (overrides["2026-07-15"] as never) ?? null,
      },
    ],
    overtimes: [],
    leaves: [],
    summary: {
      attendance_days: 1,
      half_days: 0,
      leave_by_type: [],
      evening_overtime_hours: 0,
      other_overtime_hours: 0,
      late_minutes_total: 0,
      early_leave_minutes_total: 0,
    },
  };
}

function renderModal(props: Partial<Parameters<typeof AttendanceOverrideCalendarModal>[0]> = {}) {
  return render(
    <NotificationProvider>
      <AttendanceOverrideCalendarModal
        editTitle="编辑员工考勤修正"
        employee={EMPLOYEE}
        hasMonthlyOverride={false}
        isLocked={false}
        isManager={false}
        month="2026-07"
        onClose={vi.fn()}
        onRowRefresh={vi.fn()}
        {...props}
      />
    </NotificationProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendanceOverrideCalendarModal", () => {
  beforeEach(() => {
    mockFetchCalendar.mockResolvedValue(calendarData());
  });

  it("打开时拉取日历数据并渲染汇总条", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/出勤 1 天/)).toBeInTheDocument();
    });
    expect(mockFetchCalendar).toHaveBeenCalledWith(EMPLOYEE.id, "2026-07");
  });

  it("点选日期显示当天面板与原始明细", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();
    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    const panel = screen.getByTestId("daily-override-panel");
    expect(within(panel).getByText("2026-07-01")).toBeInTheDocument();
    expect(within(panel).getByText("周三")).toBeInTheDocument(); // 2026-07-01 是周三
    expect(screen.getByText("上班卡")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
  });

  it("点击格子直接循环切换考勤状态：无修正→全勤→上午出勤→…→跟随系统", async () => {
    const savedStatuses: Array<string | undefined> = [];
    mockSave.mockImplementation(async (payload: { status?: string }) => {
      savedStatuses.push(payload.status);
      const status = payload.status ?? "";
      return { calendar: calendarData(status ? { "2026-07-15": { status } } : {}), row: {} };
    });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-15" });

    fireEvent.click(cell); // 无修正 → 全勤
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-15", status: "全勤" }));
    });
    // 等日历刷新为全勤后（面板当前状态高亮），再点 → 上午出勤
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "标记 全勤" })).toHaveClass("is-active");
    });
    fireEvent.click(cell);
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(2);
    });
    expect(mockSave.mock.calls[1][0]).toMatchObject({ date: "2026-07-15", status: "上午出勤" });
    expect(savedStatuses).toEqual(["全勤", "上午出勤"]);
  });

  it("缺勤后再点格子恢复跟随系统（status 置空）", async () => {
    mockFetchCalendar.mockResolvedValue(calendarData({ "2026-07-15": { status: "缺勤" } }));
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-15", status: "" }));
    });
  });

  it("点击格子切换时保留该日其他修正字段（晚加/工时/备注）", async () => {
    mockFetchCalendar.mockResolvedValue(
      calendarData({ "2026-07-15": { status: "全勤", is_evening_overtime: true, work_hours: 6, remark: "补卡" } }),
    );
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": { status: "上午出勤" } }), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          date: "2026-07-15",
          status: "上午出勤",
          is_evening_overtime: true,
          work_hours: 6,
          remark: "补卡",
        }),
      );
    });
  });

  it("点击状态按钮立即保存并回传新行", async () => {
    const onRowRefresh = vi.fn();
    const row = { employee: EMPLOYEE };
    mockSave.mockResolvedValue({ calendar: calendarData(), row });
    renderModal({ onRowRefresh });

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "标记 事假" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ month: "2026-07", emp_id: EMPLOYEE.id, date: "2026-07-15", status: "事假" }),
      );
    });
    expect(onRowRefresh).toHaveBeenCalledWith(row);
  });

  it("更多信息展开后可编辑工时/晚加并保存", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1); // 首次点击触发状态循环保存
    });
    fireEvent.click(screen.getByRole("button", { name: /更多信息/ }));

    fireEvent.change(screen.getByLabelText("工时（小时）"), { target: { value: "8" } });
    fireEvent.click(screen.getByLabelText(/晚上加班/));
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          date: "2026-07-01",
          work_hours: "8",
          is_evening_overtime: true,
        }),
      );
    });
  });

  it("已有修正的日期显示当前状态、修正人与清除按钮", async () => {
    const existing = { status: "全勤", remark: "补卡", updated_by_name: "admin", updated_at: "2026-08-01T10:00:00" };
    mockFetchCalendar.mockResolvedValue(calendarData({ "2026-07-15": existing }));
    // 点击格子会触发循环切换保存，mock 返回保持原状的数据避免状态漂移
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": existing }), row: {} });
    mockClear.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    const panel = await screen.findByTestId("daily-override-panel");
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "标记 全勤" })).toHaveClass("is-active");
    });
    expect(within(panel).getByText(/admin/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "清除修正" }));

    await waitFor(() => {
      expect(mockClear).toHaveBeenCalledWith(EMPLOYEE.id, "2026-07-15");
    });
  });

  it("账套锁定时禁用全部编辑控件，点击格子只选中不保存", async () => {
    renderModal({ isLocked: true });
    await screen.findByText(/出勤 1 天/);
    expect(screen.getByText(/账套已锁定/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    expect(screen.getByTestId("daily-override-panel")).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "标记 全勤" })).toBeDisabled();
  });

  it("存在月度修正时提示最终应用以月度修正为准", async () => {
    renderModal({ hasMonthlyOverride: true });
    await screen.findByText(/出勤 1 天/);
    expect(screen.getByText(/最终应用值以月度修正为准/)).toBeInTheDocument();
  });

  it("管理人员使用管理人员状态枚举", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal({ isManager: true });
    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    expect(screen.getByRole("button", { name: "标记 出差" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标记 事假" })).toBeNull();
  });
});

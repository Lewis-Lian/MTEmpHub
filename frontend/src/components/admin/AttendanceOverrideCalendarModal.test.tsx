import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchCalendar = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());
const mockClear = vi.hoisted(() => vi.fn());
const mockSaveBatch = vi.hoisted(() => vi.fn());

vi.mock("../../api/admin", () => ({
  fetchAdminDailyOverrideCalendar: mockFetchCalendar,
  saveAdminDailyOverride: mockSave,
  clearAdminDailyOverride: mockClear,
  saveAdminDailyOverrideBatch: mockSaveBatch,
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

  it("首次点击仅选中不切换，再次点击同一格才循环切换", async () => {
    mockSave.mockImplementation(async (payload: { status?: string }) => {
      const status = payload.status ?? "";
      return { calendar: calendarData(status ? { "2026-07-15": { status } } : {}), row: {} };
    });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-15" });

    fireEvent.click(cell); // 第一次：仅选中展示
    expect(screen.getByText("当前：跟随系统")).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.click(cell); // 第二次：切到全勤（乐观立即显示）
    expect(screen.getByText("当前：全勤")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-15", status: "全勤" }));
    });

    fireEvent.click(cell); // 第三次：上午出勤
    expect(screen.getByText("当前：上午出勤")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(2);
    });
    expect(mockSave.mock.calls[1][0]).toMatchObject({ date: "2026-07-15", status: "上午出勤" });
  });

  it("切换到其他格子后重新选中，同样首次点击不切换", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cellA = screen.getByRole("button", { name: "2026-07-15" });
    const cellB = screen.getByRole("button", { name: "2026-07-01" });

    fireEvent.click(cellA); // 选中 A
    fireEvent.click(cellB); // 选中 B（A 取消选中）
    fireEvent.click(cellA); // 重新选中 A，不切换
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("daily-override-panel")).toBeInTheDocument();
  });

  it("快速连点格子只保存最终状态（防抖合并）", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": { status: "上午出勤" } }), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-15" });
    fireEvent.click(cell); // 选中
    fireEvent.click(cell); // 乐观：→ 全勤
    fireEvent.click(cell); // 乐观：→ 上午出勤

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
    expect(mockSave.mock.calls[0][0]).toMatchObject({ status: "上午出勤" });
  }, 5000);

  it("缺勤的格子再次点击直接切到全勤（不再经过跟随系统）", async () => {
    mockFetchCalendar.mockResolvedValue(calendarData({ "2026-07-15": { status: "缺勤" } }));
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": { status: "全勤" } }), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-15" });
    fireEvent.click(cell); // 选中
    expect(screen.getByText("当前：缺勤")).toBeInTheDocument();
    fireEvent.click(cell); // 切换 → 全勤
    expect(screen.getByText("当前：全勤")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-15", status: "全勤" }));
    });
  });

  it("点击格子切换时保留该日其他修正字段（晚加/工时/备注）", async () => {
    mockFetchCalendar.mockResolvedValue(
      calendarData({ "2026-07-15": { status: "全勤", is_evening_overtime: true, work_hours: 6, remark: "补卡" } }),
    );
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": { status: "上午出勤" } }), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-15" });
    fireEvent.click(cell); // 选中
    fireEvent.click(cell); // 切换
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
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" })); // 首次点击仅选中
    expect(mockSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "标记 事假" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ month: "2026-07", emp_id: EMPLOYEE.id, date: "2026-07-15", status: "事假" }),
      );
    });
    expect(onRowRefresh).toHaveBeenCalledWith(row);
  });

  it("更多信息默认展开，可直接编辑工时/晚加并保存", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" })); // 首次点击仅选中
    expect(screen.getByLabelText("工时（小时）")).toBeVisible(); // 无需点开，默认展开

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

  it("已有假种修正的日期显示当前状态、修正人与清除按钮", async () => {
    const existing = { status: "事假", remark: "补卡", updated_by_name: "admin", updated_at: "2026-08-01T10:00:00" };
    mockFetchCalendar.mockResolvedValue(calendarData({ "2026-07-15": existing }));
    // 点击格子会触发循环切换保存，mock 返回保持原状的数据避免状态漂移
    mockSave.mockResolvedValue({ calendar: calendarData({ "2026-07-15": existing }), row: {} });
    mockClear.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    const panel = await screen.findByTestId("daily-override-panel");
    await waitFor(() => {
      expect(within(panel).getByText("当前：事假")).toBeInTheDocument();
    });
    expect(within(panel).getByRole("button", { name: "标记 事假" })).toHaveClass("is-active");
    expect(within(panel).getByText(/admin/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "清除修正" }));

    await waitFor(() => {
      expect(mockClear).toHaveBeenCalledWith(EMPLOYEE.id, "2026-07-15");
    });
  });

  it("面板不显示可循环切换的出勤状态按钮，仅显示假种", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();
    await screen.findByText(/出勤 1 天/);
    const cell = screen.getByRole("button", { name: "2026-07-01" });
    fireEvent.click(cell); // 首次点击仅选中
    for (const status of ["全勤", "上午出勤", "下午出勤", "缺勤"]) {
      expect(screen.queryByRole("button", { name: `标记 ${status}` })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "标记 事假" })).toBeInTheDocument();
    expect(screen.getByText("当前：跟随系统")).toBeInTheDocument();
    fireEvent.click(cell); // 再次点击切换（乐观立即显示）
    expect(screen.getByText("当前：全勤")).toBeInTheDocument();
  });

  it("账套锁定时禁用全部编辑控件，点击格子只选中不保存", async () => {
    renderModal({ isLocked: true });
    await screen.findByText(/出勤 1 天/);
    expect(screen.getByText(/账套已锁定/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    expect(screen.getByTestId("daily-override-panel")).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "标记 事假" })).toBeDisabled();
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

  it("单日面板勾选「算菜票」并保存", async () => {
    mockSave.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    fireEvent.click(screen.getByLabelText(/算菜票/));
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-01", is_meal_ticket: true }));
    });
  });

  it("多选模式：点击格子勾选/取消，不触发单日保存", async () => {
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    const cellA = screen.getByRole("button", { name: "2026-07-01" });
    const cellB = screen.getByRole("button", { name: "2026-07-15" });

    fireEvent.click(cellA); // 勾选 A
    fireEvent.click(cellB); // 勾选 B
    expect(cellA).toHaveClass("is-multi-selected");
    expect(cellB).toHaveClass("is-multi-selected");
    expect(screen.getByText(/已选 2 天/)).toBeInTheDocument();

    fireEvent.click(cellA); // 取消 A
    expect(cellA).not.toHaveClass("is-multi-selected");
    expect(screen.getByText(/已选 1 天/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockSaveBatch).not.toHaveBeenCalled();
  });

  it("多选模式下批量算菜票调用批量接口并刷新", async () => {
    const onRowRefresh = vi.fn();
    const row = { employee: EMPLOYEE };
    mockSaveBatch.mockResolvedValue({
      calendar: calendarData({ "2026-07-01": { is_meal_ticket: true }, "2026-07-15": { is_meal_ticket: true } }),
      row,
    });
    renderModal({ onRowRefresh });

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01" }));
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    fireEvent.click(screen.getByRole("button", { name: "批量算菜票" }));

    await waitFor(() => {
      expect(mockSaveBatch).toHaveBeenCalledWith({
        month: "2026-07",
        emp_id: EMPLOYEE.id,
        dates: ["2026-07-01", "2026-07-15"],
        is_meal_ticket: true,
      });
    });
    expect(onRowRefresh).toHaveBeenCalledWith(row);
    // 成功后清空勾选并显示菜徽章
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "2026-07-01" })).not.toHaveClass("is-multi-selected");
    });
    expect(screen.getAllByText("菜")).toHaveLength(2);
  });

  it("多选模式下批量取消菜票传 false", async () => {
    mockSaveBatch.mockResolvedValue({ calendar: calendarData(), row: {} });
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("button", { name: "2026-07-15" }));
    fireEvent.click(screen.getByRole("button", { name: "批量取消菜票" }));

    await waitFor(() => {
      expect(mockSaveBatch).toHaveBeenCalledWith(
        expect.objectContaining({ dates: ["2026-07-15"], is_meal_ticket: false }),
      );
    });
  });

  it("退出多选模式清空勾选并恢复单选交互", async () => {
    renderModal();

    await screen.findByText(/出勤 1 天/);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    const cell = screen.getByRole("button", { name: "2026-07-15" });
    fireEvent.click(cell);
    expect(cell).toHaveClass("is-multi-selected");

    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
    expect(cell).not.toHaveClass("is-multi-selected");

    fireEvent.click(cell); // 恢复单选：首次点击仅选中
    expect(screen.getByTestId("daily-override-panel")).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("账套锁定时多选按钮禁用", async () => {
    renderModal({ isLocked: true });
    await screen.findByText(/出勤 1 天/);
    expect(screen.getByRole("button", { name: "多选" })).toBeDisabled();
  });
});

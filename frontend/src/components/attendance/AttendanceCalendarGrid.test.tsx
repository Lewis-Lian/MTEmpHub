import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AttendanceCalendarGrid from "./AttendanceCalendarGrid";
import type { AttendanceCalendarData } from "../../types/query";

const DATA: AttendanceCalendarData = {
  employee: { id: 1, emp_no: "E001", name: "员工甲", dept_name: "制造一部" },
  month: "2026-07",
  days: [
    {
      date: "2026-07-01", check_in_times: ["07:32", "11:39"], check_out_times: ["16:44", "19:28"],
      punch_count: 4, actual_hours: 8, late_minutes: 0, early_leave_minutes: 0,
      is_half_day: false, exception_reason: "",
    },
    {
      date: "2026-07-02", check_in_times: ["07:45"], check_out_times: ["11:30"],
      punch_count: 2, actual_hours: 4, late_minutes: 12, early_leave_minutes: 0,
      is_half_day: true, exception_reason: "",
    },
  ],
  overtimes: [
    { date: "2026-07-01", is_evening: true, is_weekend: false, is_holiday: false, hours: 2.5 },
    { date: "2026-07-05", is_evening: false, is_weekend: true, is_holiday: false, hours: 3 },
  ],
  leaves: [{ date: "2026-07-03", leave_type: "出差", duration: 1 }],
  summary: {
    attendance_days: 1.5, half_days: 1,
    leave_by_type: [{ leave_type: "出差", count: 1, days: 1 }],
    evening_overtime_hours: 2.5, other_overtime_hours: 3,
    late_minutes_total: 12, early_leave_minutes_total: 0,
  },
};

afterEach(() => cleanup());

describe("AttendanceCalendarGrid", () => {
  it("渲染周一首月历与前导空格（2026-07-01 是周三）", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    expect(screen.getByText("周一")).toBeInTheDocument();
    // 7 月 1 日是周三：前导 2 个空格 + 1 号在周三列
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("格子显示首末刷卡、徽章与汇总条", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    expect(screen.getByText("07:32-19:28")).toBeInTheDocument();
    expect(screen.getByText("晚加 2.5h")).toBeInTheDocument();
    expect(screen.getByText("迟 12′")).toBeInTheDocument();
    expect(screen.getByText("半勤")).toBeInTheDocument();
    expect(screen.getByText("出差")).toBeInTheDocument();
    expect(screen.getByText(/出勤 1\.5 天/)).toBeInTheDocument();
  });

  it("点击日格弹出当天完整明细", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: /2026-07-01/ }));
    expect(screen.getByText("11:39")).toBeInTheDocument();
    expect(screen.getByText(/4 次/)).toBeInTheDocument();
  });
});

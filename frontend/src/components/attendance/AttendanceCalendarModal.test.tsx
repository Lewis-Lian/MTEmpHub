import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttendanceCalendarModal from "./AttendanceCalendarModal";
import * as queryApi from "../../api/query";

vi.mock("../../api/query", () => ({ fetchAttendanceCalendar: vi.fn() }));

const DATA = {
  employee: { id: 1, emp_no: "E001", name: "员工甲", dept_name: "制造一部" },
  month: "2026-07",
  days: [], overtimes: [], leaves: [],
  summary: {
    attendance_days: 0, half_days: 0, leave_by_type: [],
    evening_overtime_hours: 0, other_overtime_hours: 0,
    late_minutes_total: 0, early_leave_minutes_total: 0,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendanceCalendarModal", () => {
  it("open 时拉取数据并渲染弹窗", async () => {
    vi.mocked(queryApi.fetchAttendanceCalendar).mockResolvedValue(DATA as never);
    render(<AttendanceCalendarModal employeeId={1} month="2026-07" open onClose={() => {}} />);
    expect(queryApi.fetchAttendanceCalendar).toHaveBeenCalledWith(1, "2026-07");
    await waitFor(() => expect(screen.getByRole("dialog", { name: "考勤日历" })).toBeInTheDocument());
    expect(screen.getByText(/员工甲/)).toBeInTheDocument();
  });

  it("open=false 时不渲染也不拉取", () => {
    render(<AttendanceCalendarModal employeeId={1} month="2026-07" open={false} onClose={() => {}} />);
    expect(queryApi.fetchAttendanceCalendar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

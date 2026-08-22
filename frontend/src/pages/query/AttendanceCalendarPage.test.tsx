import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBootstrap = vi.hoisted(() => vi.fn());
const mockCalendar = vi.hoisted(() => vi.fn());

vi.mock("../../api/query", () => ({
  fetchQueryBootstrap: mockBootstrap,
  fetchAttendanceCalendar: mockCalendar,
}));

import AttendanceCalendarPage from "./AttendanceCalendarPage";
import { ConfirmProvider } from "../../components/feedback/ConfirmDialog";

function renderPage() {
  return render(
    <ConfirmProvider>
      <AttendanceCalendarPage />
    </ConfirmProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendanceCalendarPage", () => {
  beforeEach(() => {
    mockBootstrap.mockResolvedValue({
      employees: [
        { id: 1, emp_no: "E001", name: "员工甲", dept_id: null, dept_name: "制造一部", is_manager: false },
      ],
      account_sets: [
        { id: 2, month: "2026-06", name: "2026年6月", is_active: false },
        { id: 1, month: "2026-05", name: "2026年5月", is_active: true },
      ],
      departments: [],
    });
    mockCalendar.mockResolvedValue({
      employee: { id: 1, emp_no: "E001", name: "员工甲", dept_name: "制造一部" },
      month: "2026-05",
      days: [],
      overtimes: [],
      leaves: [],
      summary: {
        attendance_days: 0, half_days: 0, leave_by_type: [],
        evening_overtime_hours: 0, other_overtime_hours: 0,
        late_minutes_total: 0, early_leave_minutes_total: 0,
      },
    });
  });

  it("考勤月份默认为当前激活账套月份，而非自然月", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("2026年05月")).toBeInTheDocument();
    });
  });

  it("员工选择框为方块 checkbox，与多选员工筛选器一致", async () => {
    renderPage();

    const trigger = await screen.findByTitle("选择员工");
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "选择员工" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "E001 - 员工甲" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockBootstrap = vi.hoisted(() => vi.fn());
const mockHeaderRows = vi.hoisted(() => vi.fn());
const mockCalendar = vi.hoisted(() => vi.fn());
const selectedEmployeeId = vi.hoisted(() => ({ value: 7 }));

vi.mock("../../api/query", () => ({
  fetchQueryBootstrap: mockBootstrap,
  fetchHeaderRows: mockHeaderRows,
  fetchAttendanceCalendar: mockCalendar,
}));

vi.mock("../../components/query/EmployeePicker", () => ({
  default: ({ onChange }: { onChange: (ids: number[]) => void }) => (
    <button type="button" onClick={() => onChange([selectedEmployeeId.value])}>选择张三</button>
  ),
}));

vi.mock("../../components/query/AccountSetSelector", () => ({
  default: () => <span>2026年5月</span>,
}));

vi.mock("../../components/attendance/AttendanceCalendarGrid", () => ({
  default: () => <div>考勤日历</div>,
}));

describe("IndividualAttendancePage", () => {
  it("初始化状态下展示空状态引导", async () => {
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 7, emp_no: "E007", name: "张三", dept_id: 1, dept_name: "研发部", is_manager: false }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);

    await waitFor(() => expect(screen.getByText("请选择人员后点击查询")).toBeInTheDocument());
  });

  it("选择单个员工后展示个人档案、核心指标卡片、汇总、日历以及打卡请假加班明细", async () => {
    selectedEmployeeId.value = 7;
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 7, emp_no: "E007", name: "张三", dept_id: 1, dept_name: "研发部", is_manager: false }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });
    mockHeaderRows.mockResolvedValue({ headers: ["人员名称", "考勤天数"], rows: [["张三", 20]] });
    mockCalendar.mockResolvedValue({
      employee: { id: 7, emp_no: "E007", name: "张三", dept_name: "研发部" },
      month: "2026-05",
      days: [
        {
          date: "2026-05-04",
          punch_count: 2,
          check_in_times: ["08:55"],
          check_out_times: ["18:05"],
          late_minutes: 0,
          early_leave_minutes: 0,
        },
      ],
      overtimes: [{ date: "2026-05-03", is_evening: false, is_weekend: true, is_holiday: false, hours: 4 }],
      leaves: [{ date: "2026-05-08", leave_type: "事假", duration: 1, start_time: "2026-05-08 09:00", end_time: "2026-05-08 18:00", reason: "私事处理" }],
      summary: { attendance_days: 20, half_days: 0, leave_by_type: [], evening_overtime_hours: 0, other_overtime_hours: 4, late_minutes_total: 0, early_leave_minutes_total: 0 },
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);

    await waitFor(() => expect(screen.getByText("选择张三")).toBeInTheDocument());
    fireEvent.click(screen.getByText("选择张三"));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(mockHeaderRows).toHaveBeenCalledWith("/api/query/employee-dashboard", expect.any(URLSearchParams)));
    expect(mockCalendar).toHaveBeenCalledWith(7, "2026-05");

    // 5 栏核心 KPI 指标卡片
    expect(screen.getByText("出勤天数")).toBeInTheDocument();
    expect(screen.getByText("异常打卡")).toBeInTheDocument();
    expect(screen.getByText("迟到 / 早退")).toBeInTheDocument();
    expect(screen.getByText("请假统计")).toBeInTheDocument();
    expect(screen.getByText("加班累计")).toBeInTheDocument();

    // 档案标签
    expect(screen.getByText("工号: E007")).toBeInTheDocument();
    expect(screen.getByText("部门: 研发部")).toBeInTheDocument();
    expect(screen.getByText("账套: 2026-05")).toBeInTheDocument();
    expect(screen.getByText("异常打卡: 0 次")).toBeInTheDocument();

    // 各区块标题与日历
    expect(screen.getByRole("heading", { name: "考勤日历" })).toBeInTheDocument();
    expect(screen.getByText("打卡明细")).toBeInTheDocument();
    expect(screen.getByText("请假明细")).toBeInTheDocument();
    expect(screen.getByText("加班明细")).toBeInTheDocument();
    expect(document.querySelector(".individual-attendance-page.employee-dashboard-page")).not.toBeNull();
    expect(screen.getAllByTestId("section-icon")).toHaveLength(3);

    // 打卡明细默认展示「打卡数据」表头与合并打卡时间
    expect(screen.getByText("打卡数据")).toBeInTheDocument();
    expect(screen.getByText("08:55、18:05")).toBeInTheDocument();

    // 考勤明细全屏放大与还原测试
    const fullscreenBtn = screen.getByRole("button", { name: "放大到页面内全屏" });
    expect(fullscreenBtn).toBeInTheDocument();
    fireEvent.click(fullscreenBtn);
    expect(document.querySelector(".individual-details-card.is-fullscreen")).not.toBeNull();
    expect(screen.getByRole("button", { name: "还原窗口" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "还原窗口" }));
    expect(document.querySelector(".individual-details-card.is-fullscreen")).toBeNull();

    // 切换明细 Tab 测试
    fireEvent.click(screen.getByText("请假明细"));
    expect(screen.getByText("私事处理")).toBeInTheDocument();

    fireEvent.click(screen.getByText("加班明细"));
    expect(screen.getByText("4 小时")).toBeInTheDocument();
  });

  it("选择管理人员时调用管理人员汇总接口并正确标记角色徽章", async () => {
    selectedEmployeeId.value = 9;
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 9, emp_no: "M009", name: "李四", dept_id: 1, dept_name: "管理部", is_manager: true }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });
    mockHeaderRows.mockResolvedValue({ headers: ["姓名"], rows: [["李四"]] });
    mockCalendar.mockResolvedValue({
      employee: { id: 9, emp_no: "M009", name: "李四", dept_name: "管理部" },
      month: "2026-05",
      days: [],
      overtimes: [],
      leaves: [],
      summary: { attendance_days: 0, half_days: 0, leave_by_type: [], evening_overtime_hours: 0, other_overtime_hours: 0, late_minutes_total: 0, early_leave_minutes_total: 0 },
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);
    fireEvent.click(await screen.findByText("选择张三"));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(mockHeaderRows).toHaveBeenCalledWith("/api/query/manager-attendance", expect.any(URLSearchParams)));
    expect(screen.getByText("工号: M009")).toBeInTheDocument();
  });

  it("当月存在打卡1次或3次时准确统计异常打卡次数", async () => {
    selectedEmployeeId.value = 7;
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 7, emp_no: "E007", name: "张三", dept_id: 1, dept_name: "研发部", is_manager: false }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });
    mockHeaderRows.mockResolvedValue({ headers: ["人员名称"], rows: [["张三"]] });
    mockCalendar.mockResolvedValue({
      employee: { id: 7, emp_no: "E007", name: "张三", dept_name: "研发部" },
      month: "2026-05",
      days: [
        { date: "2026-05-04", punch_count: 1, check_in_times: ["08:55"], check_out_times: [], late_minutes: 0, early_leave_minutes: 0 },
        { date: "2026-05-05", punch_count: 3, check_in_times: ["08:55", "13:00"], check_out_times: ["18:00"], late_minutes: 0, early_leave_minutes: 0 },
        { date: "2026-05-06", punch_count: 2, check_in_times: ["08:55"], check_out_times: ["18:00"], late_minutes: 10, early_leave_minutes: 0 },
      ],
      overtimes: [],
      leaves: [],
      summary: { attendance_days: 3, half_days: 0, leave_by_type: [], evening_overtime_hours: 0, other_overtime_hours: 0, late_minutes_total: 10, early_leave_minutes_total: 0 },
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);
    fireEvent.click(await screen.findByText("选择张三"));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    // 5月4日(1次)与5月5日(3次)共计2次异常打卡；5月6日虽迟到但打卡2次不计入异常打卡次数
    await waitFor(() => expect(screen.getByText("异常打卡: 2 次")).toBeInTheDocument());
    expect(screen.getByText("异常打卡共 2 次")).toBeInTheDocument();
  });

  it("异常原因或汇总中的旷工统一显示为缺勤", async () => {
    selectedEmployeeId.value = 7;
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 7, emp_no: "E007", name: "张三", dept_id: 1, dept_name: "研发部", is_manager: false }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });
    mockHeaderRows.mockResolvedValue({
      headers: ["人员名称", "旷工天数"],
      rows: [["张三", "1"]],
    });
    mockCalendar.mockResolvedValue({
      employee: { id: 7, emp_no: "E007", name: "张三", dept_name: "研发部" },
      month: "2026-05",
      days: [
        { date: "2026-05-08", punch_count: 0, check_in_times: [], check_out_times: [], late_minutes: 0, early_leave_minutes: 0, exception_reason: "旷工" },
      ],
      overtimes: [],
      leaves: [],
      summary: { attendance_days: 0, half_days: 0, leave_by_type: [], evening_overtime_hours: 0, other_overtime_hours: 0, late_minutes_total: 0, early_leave_minutes_total: 0 },
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);
    fireEvent.click(await screen.findByText("选择张三"));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(screen.getByText("缺勤天数")).toBeInTheDocument());
    expect(screen.queryByText("旷工天数")).toBeNull();
    expect(screen.getByText("缺勤")).toBeInTheDocument();
    expect(screen.queryByText("旷工")).toBeNull();
  });

  it("考勤明细表格滚动区域支持鼠标拖动浏览", async () => {
    selectedEmployeeId.value = 7;
    mockBootstrap.mockResolvedValue({
      employees: [{ id: 7, emp_no: "E007", name: "张三", dept_id: 1, dept_name: "研发部", is_manager: false }],
      account_sets: [{ id: 1, month: "2026-05", name: "2026年5月", is_active: true }],
      departments: [],
    });
    mockHeaderRows.mockResolvedValue({ headers: ["人员名称"], rows: [["张三"]] });
    mockCalendar.mockResolvedValue({
      employee: { id: 7, emp_no: "E007", name: "张三", dept_name: "研发部" },
      month: "2026-05",
      days: [
        { date: "2026-05-04", punch_count: 2, check_in_times: ["08:55"], check_out_times: ["18:05"], late_minutes: 0, early_leave_minutes: 0 },
      ],
      overtimes: [],
      leaves: [],
      summary: { attendance_days: 1, half_days: 0, leave_by_type: [], evening_overtime_hours: 0, other_overtime_hours: 0, late_minutes_total: 0, early_leave_minutes_total: 0 },
    });

    const { default: IndividualAttendancePage } = await import("./IndividualAttendancePage");
    render(<IndividualAttendancePage />);
    fireEvent.click(await screen.findByText("选择张三"));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(screen.getByText("打卡数据")).toBeInTheDocument());

    const tableWrap = document.querySelector(".individual-details-card .legacy-table-wrap") as HTMLDivElement;
    expect(tableWrap).not.toBeNull();

    fireEvent.mouseDown(tableWrap, { clientX: 100, clientY: 100 });
    expect(tableWrap.classList.contains("is-dragging")).toBe(true);

    fireEvent.mouseMove(window, { clientX: 60, clientY: 70 });
    expect(tableWrap.scrollLeft).toBe(40);
    expect(tableWrap.scrollTop).toBe(30);

    fireEvent.mouseUp(window);
    expect(tableWrap.classList.contains("is-dragging")).toBe(false);
  });
});

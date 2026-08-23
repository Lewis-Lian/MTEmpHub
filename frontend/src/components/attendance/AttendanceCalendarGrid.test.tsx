import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttendanceCalendarGrid from "./AttendanceCalendarGrid";
import type { AttendanceCalendarData } from "../../types/query";

// 2026-07 为过去月份（当前时间 2026-08+），其中无数据日按缺勤口径染红
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

const MULTI_OVERTIME_DATA: AttendanceCalendarData = {
  ...DATA,
  overtimes: [
    { date: "2026-07-05", is_evening: true, is_weekend: false, is_holiday: false, hours: 2.5 },
    { date: "2026-07-05", is_evening: false, is_weekend: true, is_holiday: false, hours: 3 },
  ],
};

const MULTI_LEAVE_DATA: AttendanceCalendarData = {
  ...DATA,
  leaves: [
    { date: "2026-07-03", leave_type: "事假", duration: 0.5 },
    { date: "2026-07-03", leave_type: "出差", duration: 0.5 },
  ],
};

// 优先级链：出差 > 婚假 > 丧假 > 半勤 > 晚加班 > 出勤
const PRIORITY_DATA: AttendanceCalendarData = {
  ...DATA,
  days: [
    { ...DATA.days[0], date: "2026-07-12", is_half_day: true, late_minutes: 0 },
    { ...DATA.days[0], date: "2026-07-13", is_half_day: false },
    { ...DATA.days[0], date: "2026-07-14", is_half_day: false },
  ],
  overtimes: [
    { date: "2026-07-12", is_evening: true, is_weekend: false, is_holiday: false, hours: 2 },
    { date: "2026-07-13", is_evening: true, is_weekend: false, is_holiday: false, hours: 2 },
  ],
  leaves: [
    { date: "2026-07-10", leave_type: "出差", duration: 1 },
    { date: "2026-07-10", leave_type: "婚假", duration: 1 },
    { date: "2026-07-10", leave_type: "丧假", duration: 1 },
    { date: "2026-07-11", leave_type: "婚假", duration: 1 },
    { date: "2026-07-11", leave_type: "丧假", duration: 1 },
    { date: "2026-07-14", leave_type: "丧假", duration: 1 },
  ],
};

// 未来月份：无数据日不标记缺勤
const FUTURE_DATA: AttendanceCalendarData = {
  ...DATA,
  month: "2099-01",
  days: [{ ...DATA.days[0], date: "2099-01-04" }],
  overtimes: [],
  leaves: [],
};

// 整月无任何数据：不渲染缺勤红
const EMPTY_DATA: AttendanceCalendarData = {
  ...DATA,
  days: [],
  overtimes: [],
  leaves: [],
};

afterEach(() => cleanup());

function getCell(date: string) {
  return screen.getByRole("button", { name: date });
}

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
    expect(screen.getByText("晚加 +2.5h")).toBeInTheDocument();
    expect(screen.getAllByText("半勤").length).toBeGreaterThan(0);
    expect(screen.getAllByText("出差").length).toBeGreaterThan(0);
    expect(screen.getByText(/出勤 1\.5 天/)).toBeInTheDocument();
  });

  it("迟到/早退不再渲染格子徽章，弹层明细行保留", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    expect(screen.queryByText("迟 12′")).not.toBeInTheDocument();
    expect(screen.queryByText(/早退 \d+′/)).not.toBeInTheDocument();
    fireEvent.click(getCell("2026-07-02"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("迟到")).toBeInTheDocument();
    expect(within(dialog).getByText("12 分钟")).toBeInTheDocument();
  });

  it("点击日格弹出当天完整明细", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: /2026-07-01/ }));
    expect(screen.getByText("11:39")).toBeInTheDocument();
    expect(screen.getByText(/4 次/)).toBeInTheDocument();
  });

  it("弹层头部显示星期，点击遮罩关闭、点击卡片不关闭", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    fireEvent.click(getCell("2026-07-01"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("2026-07-01")).toBeInTheDocument();
    expect(within(dialog).getByText("周三")).toBeInTheDocument(); // 2026-07-01 是周三
    fireEvent.click(within(dialog).getByText("上班卡")); // 点卡片内容不关闭
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog); // 点遮罩关闭
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("同日两条加班（晚间 + 周末白天）在格子与弹层都完整展示", () => {
    render(<AttendanceCalendarGrid data={MULTI_OVERTIME_DATA} />);
    expect(screen.getByText("晚加 +2.5h")).toBeInTheDocument();
    expect(screen.getByText("周 +3h")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026-07-05/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("晚上加班")).toBeInTheDocument();
    expect(within(dialog).getByText("2.5 小时")).toBeInTheDocument();
    expect(within(dialog).getByText("周末加班")).toBeInTheDocument();
    expect(within(dialog).getByText("3 小时")).toBeInTheDocument();
  });

  it("同日两个假种（事假 + 出差）在格子与弹层都完整展示", () => {
    render(<AttendanceCalendarGrid data={MULTI_LEAVE_DATA} />);
    expect(screen.getByText("事假")).toBeInTheDocument();
    expect(screen.getAllByText("出差").length).toBeGreaterThan(0); // 假种徽章 + 图例
    fireEvent.click(screen.getByRole("button", { name: /2026-07-03/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("事假")).toBeInTheDocument();
    expect(within(dialog).getByText("出差")).toBeInTheDocument();
    expect(within(dialog).getAllByText("0.5 天").length).toBe(2);
  });

  it("同日两张事假单：格子徽章去重，弹层展示 OA 单明细", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      leaves: [
        { date: "2026-07-03", leave_type: "事假", duration: 0.17, leave_no: "L101", start_time: "2026-07-03 08:00", end_time: "2026-07-03 12:00", reason: "家中有事", approval_status: "已审批" },
        { date: "2026-07-03", leave_type: "事假", duration: 0.17, leave_no: "L102", start_time: "2026-07-03 13:00", end_time: "2026-07-03 17:00", reason: "下午外出", approval_status: "已审批" },
      ],
    };
    render(<AttendanceCalendarGrid data={data} />);
    const cell = getCell("2026-07-03");
    expect(within(cell).getAllByText("事假")).toHaveLength(1); // 同假种多单只显示一个徽章
    fireEvent.click(cell);
    expect(screen.getByText("家中有事")).toBeInTheDocument();
    expect(screen.getByText("下午外出")).toBeInTheDocument();
    expect(screen.getByText("2026-07-03 08:00 ~ 2026-07-03 12:00")).toBeInTheDocument();
    expect(screen.getAllByText(/已审批/)).toHaveLength(2);
  });

  it("格子按状态填充背景色类", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    expect(getCell("2026-07-01")).toHaveClass("is-bg-evening"); // 出勤 + 晚加班 → 晚加班优先
    expect(getCell("2026-07-02")).toHaveClass("is-bg-half");
    expect(getCell("2026-07-03")).toHaveClass("is-bg-trip");
    expect(getCell("2026-07-04")).toHaveClass("is-bg-absent"); // 过去无数据日
    expect(getCell("2026-07-05")).toHaveClass("is-bg-attendance"); // 周末加班视同出勤
  });

  it("无刷卡的旷工记录日显示缺勤红而非出勤绿", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      days: [
        { ...DATA.days[0], date: "2026-07-14" },
        {
          ...DATA.days[0],
          date: "2026-07-15",
          check_in_times: [],
          check_out_times: [],
          punch_count: 0,
          actual_hours: 0,
        },
      ],
    };
    render(<AttendanceCalendarGrid data={data} />);
    expect(getCell("2026-07-14")).toHaveClass("is-bg-attendance"); // 有刷卡记录 → 出勤
    expect(getCell("2026-07-15")).toHaveClass("is-bg-absent"); // 旷工日（有记录无刷卡）→ 缺勤
    expect(within(getCell("2026-07-15")).getByText("缺勤")).toBeInTheDocument(); // 缺勤格子带文字徽标
  });

  it("多状态时按优先级取第一个命中", () => {
    render(<AttendanceCalendarGrid data={PRIORITY_DATA} />);
    expect(getCell("2026-07-10")).toHaveClass("is-bg-trip"); // 出差 > 婚假 > 丧假
    expect(getCell("2026-07-11")).toHaveClass("is-bg-marriage"); // 婚假 > 丧假
    expect(getCell("2026-07-12")).toHaveClass("is-bg-half"); // 半勤 > 晚加班
    expect(getCell("2026-07-13")).toHaveClass("is-bg-evening"); // 晚加班 > 出勤
    expect(getCell("2026-07-14")).toHaveClass("is-bg-funeral"); // 丧假 > 出勤
  });

  it("异常不参与底色、角标与弹层展示", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      days: [{ ...DATA.days[0], date: "2026-07-11", exception_reason: "忘打卡" }],
    };
    render(<AttendanceCalendarGrid data={data} />);
    expect(getCell("2026-07-11")).toHaveClass("is-bg-attendance"); // 有 day 即出勤，异常无底色
    expect(screen.queryByText("⚠")).not.toBeInTheDocument();
    fireEvent.click(getCell("2026-07-11"));
    expect(screen.queryByText(/异常/)).not.toBeInTheDocument();
  });

  it("缺勤仅标记过去无数据日：未来日期与整月空数据不标记", () => {
    const { container } = render(
      <>
        <AttendanceCalendarGrid data={FUTURE_DATA} />
        <AttendanceCalendarGrid data={EMPTY_DATA} />
      </>,
    );
    expect(screen.getByRole("button", { name: "2099-01-04" })).toHaveClass("is-bg-attendance");
    expect(screen.getByRole("button", { name: "2099-01-05" }).className).not.toMatch(/is-bg-/);
    expect(getCell("2026-07-04").className).not.toMatch(/is-bg-/);
    expect(container.querySelectorAll(".attendance-calendar-cell.is-bg-absent")).toHaveLength(0);
  });

  it("图例渲染七色修订版七项", () => {
    const { container } = render(<AttendanceCalendarGrid data={DATA} />);
    const legend = container.querySelector(".attendance-calendar-legend");
    expect(legend).toBeTruthy();
    for (const key of ["trip", "marriage", "funeral", "half", "evening", "attendance", "absent"]) {
      expect(legend?.querySelector(`.is-bg-${key}`)).toBeTruthy();
    }
    expect(screen.getByText("婚假")).toBeInTheDocument();
    expect(screen.getByText("丧假")).toBeInTheDocument();
    expect(screen.getByText("晚加班")).toBeInTheDocument();
    expect(within(legend as HTMLElement).getByText("缺勤")).toBeInTheDocument(); // 图例的"缺勤"与格内徽章同名，限定图例容器
  });
});

describe("AttendanceCalendarGrid 修正模式（可选 props）", () => {
  it("传入 onCellSelect 时点击格子走外部回调且不弹内部明细弹层", () => {
    const onCellSelect = vi.fn();
    render(<AttendanceCalendarGrid data={DATA} onCellSelect={onCellSelect} />);
    fireEvent.click(getCell("2026-07-01"));
    expect(onCellSelect).toHaveBeenCalledWith("2026-07-01");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("未传 onCellSelect 时保持原有明细弹层行为", () => {
    render(<AttendanceCalendarGrid data={DATA} />);
    fireEvent.click(getCell("2026-07-01"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("selectedDate 高亮对应格子", () => {
    render(<AttendanceCalendarGrid data={DATA} selectedDate="2026-07-02" />);
    expect(getCell("2026-07-02")).toHaveClass("is-selected");
    expect(getCell("2026-07-01")).not.toHaveClass("is-selected");
  });

  it("修正状态覆盖格子背景：全勤绿/半勤黄/缺勤红/晚加橙，且带修正徽章", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      days: [
        { ...DATA.days[0], date: "2026-07-10", override: { status: "全勤" } },
        { ...DATA.days[0], date: "2026-07-11", override: { status: "上午出勤" } },
        { ...DATA.days[0], date: "2026-07-12", override: { status: "缺勤" } },
        { ...DATA.days[0], date: "2026-07-13", override: { is_evening_overtime: true } },
      ],
      overtimes: [],
      leaves: [],
    };
    render(<AttendanceCalendarGrid data={data} />);
    expect(getCell("2026-07-10")).toHaveClass("is-bg-attendance");
    expect(getCell("2026-07-11")).toHaveClass("is-bg-half");
    expect(getCell("2026-07-12")).toHaveClass("is-bg-absent");
    expect(getCell("2026-07-13")).toHaveClass("is-bg-evening");
    expect(within(getCell("2026-07-10")).getByText("修正")).toBeInTheDocument();
    expect(within(getCell("2026-07-13")).getByText("晚加")).toBeInTheDocument();
  });

  it("假种修正状态：出差/婚假/丧假用专属色，其余假种用请假色", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      days: [
        { ...DATA.days[0], date: "2026-07-10", override: { status: "出差" } },
        { ...DATA.days[0], date: "2026-07-11", override: { status: "婚假" } },
        { ...DATA.days[0], date: "2026-07-12", override: { status: "丧假" } },
        { ...DATA.days[0], date: "2026-07-13", override: { status: "事假" } },
      ],
      overtimes: [],
      leaves: [],
    };
    render(<AttendanceCalendarGrid data={data} />);
    expect(getCell("2026-07-10")).toHaveClass("is-bg-trip");
    expect(getCell("2026-07-11")).toHaveClass("is-bg-marriage");
    expect(getCell("2026-07-12")).toHaveClass("is-bg-funeral");
    expect(getCell("2026-07-13")).toHaveClass("is-bg-leave");
  });

  it("无记录的修正日（合成空打卡条目）也渲染格子与修正徽章", () => {
    const data: AttendanceCalendarData = {
      ...DATA,
      days: [
        ...DATA.days,
        {
          date: "2026-07-20", check_in_times: [], check_out_times: [], punch_count: 0,
          actual_hours: 0, late_minutes: 0, early_leave_minutes: 0, is_half_day: false,
          exception_reason: "", override: { status: "全勤" },
        },
      ],
    };
    render(<AttendanceCalendarGrid data={data} />);
    expect(getCell("2026-07-20")).toHaveClass("is-bg-attendance");
    expect(within(getCell("2026-07-20")).getByText("修正")).toBeInTheDocument();
  });
});

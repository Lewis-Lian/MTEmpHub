import { useMemo, useState, type ReactNode } from "react";
import type {
  AttendanceCalendarData,
  AttendanceCalendarDay,
  AttendanceCalendarLeave,
  AttendanceCalendarOvertime,
} from "../../types/query";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface DayCell {
  date: string;
  dayOfMonth: number;
  day?: AttendanceCalendarDay;
  overtime?: AttendanceCalendarOvertime;
  leave?: AttendanceCalendarLeave;
}

export default function AttendanceCalendarGrid({ data }: { data: AttendanceCalendarData }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const cells = useMemo(() => buildCells(data), [data]);
  const selected = cells.find((cell) => cell.date === selectedDate) ?? null;

  if (cells.length === 0) {
    return <div className="attendance-calendar attendance-calendar-empty">无效月份</div>;
  }

  return (
    <div className="attendance-calendar">
      <div className="attendance-calendar-summary">
        <span className="cal-badge cal-badge-attendance">出勤 {data.summary.attendance_days} 天</span>
        <span className="cal-badge">半勤 {data.summary.half_days} 天</span>
        {data.summary.leave_by_type.map((item) => (
          <span className="cal-badge cal-badge-leave" key={item.leave_type}>
            {item.leave_type} {item.count} 次 {item.days} 天
          </span>
        ))}
        <span className="cal-badge cal-badge-evening">晚加 {data.summary.evening_overtime_hours}h</span>
        <span className="cal-badge cal-badge-overtime">加班 {data.summary.other_overtime_hours}h</span>
        {data.summary.late_minutes_total > 0 && (
          <span className="cal-badge cal-badge-late">迟到 {data.summary.late_minutes_total}′</span>
        )}
        {data.summary.early_leave_minutes_total > 0 && (
          <span className="cal-badge cal-badge-early">早退 {data.summary.early_leave_minutes_total}′</span>
        )}
      </div>

      <div className="attendance-calendar-grid" role="grid">
        {WEEKDAYS.map((label) => (
          <div className="attendance-calendar-weekday" key={label}>{label}</div>
        ))}
        {Array.from({ length: leadingSlots(data.month) }).map((_, index) => (
          <div className="attendance-calendar-cell is-empty" key={`empty-${index}`} />
        ))}
        {cells.map((cell) => (
          <button
            aria-label={cell.date}
            className={`attendance-calendar-cell${cell.day || cell.overtime || cell.leave ? " has-data" : ""}`}
            key={cell.date}
            onClick={() => setSelectedDate(cell.date)}
            type="button"
          >
            <div className="cal-day-number">{cell.dayOfMonth}</div>
            {renderPunchSummary(cell)}
            {renderBadges(cell)}
          </button>
        ))}
      </div>

      <div className="attendance-calendar-legend">
        <span className="cal-badge cal-badge-late">迟到</span>
        <span className="cal-badge cal-badge-early">早退</span>
        <span className="cal-badge">半勤（半日）</span>
        <span className="cal-badge cal-badge-leave">请假</span>
        <span className="cal-badge cal-badge-evening">晚加</span>
        <span className="cal-badge cal-badge-overtime">加班</span>
        <span className="cal-badge cal-badge-holiday">节假日加</span>
      </div>

      {selected && selected.day ? (
        <div className="attendance-calendar-daydetail" role="dialog" aria-label={`考勤明细 ${selected.date}`}>
          <div className="daydetail-card">
            <div className="daydetail-header">
              <span>{selected.date}</span>
              <button aria-label="关闭" onClick={() => setSelectedDate(null)} type="button">×</button>
            </div>
            <div className="daydetail-body">
              <div className="daydetail-row">上班卡：{renderTimes(selected.day.check_in_times)}</div>
              <div className="daydetail-row">下班卡：{renderTimes(selected.day.check_out_times)}</div>
              <div className="daydetail-row">打卡次数：{selected.day.punch_count} 次</div>
              <div className="daydetail-row">实出勤：{selected.day.actual_hours} 小时</div>
              {selected.day.late_minutes > 0 && (
                <div className="daydetail-row">迟到：{selected.day.late_minutes} 分钟</div>
              )}
              {selected.day.early_leave_minutes > 0 && (
                <div className="daydetail-row">早退：{selected.day.early_leave_minutes} 分钟</div>
              )}
              {selected.day.is_half_day && <div className="daydetail-row">半勤：是</div>}
              {selected.leave && (
                <div className="daydetail-row">{selected.leave.leave_type}：{selected.leave.duration} 天</div>
              )}
              {selected.overtime && (
                <div className="daydetail-row">
                  {selected.overtime.is_evening
                    ? "晚上加班"
                    : selected.overtime.is_holiday
                      ? "节假日加班"
                      : selected.overtime.is_weekend
                        ? "周末加班"
                        : "加班"}
                  ：{selected.overtime.hours} 小时
                </div>
              )}
              {selected.day.exception_reason && (
                <div className="daydetail-row">异常：{selected.day.exception_reason}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function leadingSlots(month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return 0;
  }
  const [yearText, monthText] = month.split("-");
  return (new Date(Number(yearText), Number(monthText) - 1, 1).getDay() + 6) % 7;
}

function buildCells(data: AttendanceCalendarData): DayCell[] {
  const month = data.month;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return [];
  }
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  const dayMap = new Map(data.days.map((day) => [day.date, day]));
  const overtimeMap = new Map(data.overtimes.map((overtime) => [overtime.date, overtime]));
  const leaveMap = new Map(data.leaves.map((leave) => [leave.date, leave]));

  return Array.from({ length: lastDayOfMonth }, (_, index) => {
    const dayOfMonth = index + 1;
    const isoDate = `${month}-${String(dayOfMonth).padStart(2, "0")}`;
    return {
      date: isoDate,
      dayOfMonth,
      day: dayMap.get(isoDate),
      overtime: overtimeMap.get(isoDate),
      leave: leaveMap.get(isoDate),
    };
  });
}

function renderPunchSummary(cell: DayCell) {
  const day = cell.day;
  if (!day || (day.check_in_times.length === 0 && day.check_out_times.length === 0)) {
    return null;
  }
  const firstIn = day.check_in_times[0];
  const lastOut = day.check_out_times[day.check_out_times.length - 1];
  const text = firstIn && lastOut ? `${firstIn}-${lastOut}` : firstIn ?? lastOut ?? "";
  return <div className="cal-punch">{text}</div>;
}

function renderBadges(cell: DayCell): ReactNode[] {
  const badges: ReactNode[] = [];
  const day = cell.day;

  if (day) {
    if (day.late_minutes > 0) {
      badges.push(
        <span className="cal-badge cal-badge-late" key="late">迟 {day.late_minutes}′</span>,
      );
    }
    if (day.early_leave_minutes > 0) {
      badges.push(
        <span className="cal-badge cal-badge-early" key="early">早退 {day.early_leave_minutes}′</span>,
      );
    }
    if (day.is_half_day) {
      badges.push(<span className="cal-badge" key="half">半勤</span>);
    }
  }
  if (cell.leave) {
    badges.push(
      <span className="cal-badge cal-badge-leave" key="leave">{cell.leave.leave_type}</span>,
    );
  }
  if (cell.overtime) {
    const overtime = cell.overtime;
    if (overtime.is_evening) {
      badges.push(
        <span className="cal-badge cal-badge-evening" key="overtime">晚加 +{overtime.hours}h</span>,
      );
    } else if (overtime.is_holiday) {
      badges.push(
        <span className="cal-badge cal-badge-holiday" key="overtime">节假 +{overtime.hours}h</span>,
      );
    } else if (overtime.is_weekend) {
      badges.push(
        <span className="cal-badge cal-badge-overtime" key="overtime">周 +{overtime.hours}h</span>,
      );
    } else {
      badges.push(
        <span className="cal-badge cal-badge-overtime" key="overtime">+{overtime.hours}h</span>,
      );
    }
  }
  if (day?.exception_reason) {
    badges.push(<span className="cal-badge cal-badge-exception" key="exception">⚠</span>);
  }
  return badges;
}

function renderTimes(times: string[]) {
  if (times.length === 0) {
    return "无";
  }
  return times.map((time, index) => (
    <span className="daydetail-time" key={`${time}-${index}`}>{time}</span>
  ));
}

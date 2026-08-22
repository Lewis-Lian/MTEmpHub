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
  overtimes: AttendanceCalendarOvertime[];
  leaves: AttendanceCalendarLeave[];
}

export default function AttendanceCalendarGrid({ data }: { data: AttendanceCalendarData }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const cells = useMemo(() => buildCells(data), [data]);
  const selected = cells.find((cell) => cell.date === selectedDate) ?? null;
  const hasMonthData = data.days.length > 0 || data.overtimes.length > 0 || data.leaves.length > 0;

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
        {cells.map((cell) => {
          const bgKey = cellBackgroundKey(cell, hasMonthData);
          return (
            <button
              aria-label={cell.date}
              className={`attendance-calendar-cell${cell.day || cell.overtimes.length > 0 || cell.leaves.length > 0 ? " has-data" : ""}${bgKey !== "none" ? ` is-bg-${bgKey}` : ""}`}
              key={cell.date}
              onClick={() => setSelectedDate(cell.date)}
              type="button"
            >
              <div className="cal-day-number">{cell.dayOfMonth}</div>
              {renderPunchSummary(cell)}
              {bgKey === "absent" && <span className="cal-badge cal-badge-absent">缺勤</span>}
              {renderBadges(cell)}
            </button>
          );
        })}
      </div>

      <div className="attendance-calendar-legend">
        <span className="cal-badge is-bg-trip">出差</span>
        <span className="cal-badge is-bg-marriage">婚假</span>
        <span className="cal-badge is-bg-funeral">丧假</span>
        <span className="cal-badge is-bg-half">半勤</span>
        <span className="cal-badge is-bg-evening">晚加班</span>
        <span className="cal-badge is-bg-attendance">出勤</span>
        <span className="cal-badge is-bg-absent">缺勤</span>
      </div>

      {selected && (selected.day || selected.overtimes.length > 0 || selected.leaves.length > 0) ? (
        <div className="attendance-calendar-daydetail" role="dialog" aria-label={`考勤明细 ${selected.date}`}>
          <div className="daydetail-card">
            <div className="daydetail-header">
              <span>{selected.date}</span>
              <button aria-label="关闭" onClick={() => setSelectedDate(null)} type="button">×</button>
            </div>
            <div className="daydetail-body">
              {selected.day ? (
                <>
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
                </>
              ) : null}
              {selected.leaves.map((leave, index) => (
                <div className="daydetail-row" key={`leave-${index}`}>
                  {leave.leave_type}：{leave.duration} 天
                </div>
              ))}
              {selected.overtimes.map((overtime, index) => (
                <div className="daydetail-row" key={`overtime-${index}`}>
                  {overtime.is_evening
                    ? "晚上加班"
                    : overtime.is_holiday
                      ? "节假日加班"
                      : overtime.is_weekend
                        ? "周末加班"
                        : "加班"}
                  ：{overtime.hours} 小时
                </div>
              ))}
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

// 七色修订版背景色口径（设计文档 2.9）：出差 > 婚假 > 丧假 > 半勤 > 晚加班 > 出勤 > 缺勤 > 无
type CellBackgroundKey = "trip" | "marriage" | "funeral" | "half" | "evening" | "attendance" | "absent" | "none";

function cellBackgroundKey(cell: DayCell, hasMonthData: boolean): CellBackgroundKey {
  const leaveTypes = cell.leaves.map((leave) => leave.leave_type);
  if (leaveTypes.includes("出差")) return "trip";
  if (leaveTypes.includes("婚假")) return "marriage";
  if (leaveTypes.includes("丧假")) return "funeral";
  if (cell.day?.is_half_day) return "half";
  if (cell.overtimes.some((overtime) => overtime.is_evening)) return "evening";
  // 考勤机对旷工日也会生成无刷卡的 DailyRecord（如 exception_reason=旷工），出勤须以真实刷卡判定
  if ((cell.day && hasPunch(cell.day)) || cell.overtimes.length > 0) return "attendance";
  if (hasMonthData && cell.date < todayString()) return "absent";
  return "none";
}

function hasPunch(day: AttendanceCalendarDay): boolean {
  return day.punch_count > 0 || day.check_in_times.length > 0 || day.check_out_times.length > 0;
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  const overtimesByDate = groupByDate(data.overtimes);
  const leavesByDate = groupByDate(data.leaves);

  return Array.from({ length: lastDayOfMonth }, (_, index) => {
    const dayOfMonth = index + 1;
    const isoDate = `${month}-${String(dayOfMonth).padStart(2, "0")}`;
    return {
      date: isoDate,
      dayOfMonth,
      day: dayMap.get(isoDate),
      overtimes: overtimesByDate.get(isoDate) ?? [],
      leaves: leavesByDate.get(isoDate) ?? [],
    };
  });
}

function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  return items.reduce((map, item) => {
    const list = map.get(item.date);
    if (list) {
      list.push(item);
    } else {
      map.set(item.date, [item]);
    }
    return map;
  }, new Map<string, T[]>());
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
    if (day.is_half_day) {
      badges.push(<span className="cal-badge" key="half">半勤</span>);
    }
  }
  cell.leaves.forEach((leave, index) => {
    badges.push(
      <span className="cal-badge cal-badge-leave" key={`leave-${index}`}>{leave.leave_type}</span>,
    );
  });
  cell.overtimes.forEach((overtime, index) => {
    if (overtime.is_evening) {
      badges.push(
        <span className="cal-badge cal-badge-evening" key={`overtime-${index}`}>晚加 +{overtime.hours}h</span>,
      );
    } else if (overtime.is_holiday) {
      badges.push(
        <span className="cal-badge cal-badge-holiday" key={`overtime-${index}`}>节假 +{overtime.hours}h</span>,
      );
    } else if (overtime.is_weekend) {
      badges.push(
        <span className="cal-badge cal-badge-overtime" key={`overtime-${index}`}>周 +{overtime.hours}h</span>,
      );
    } else {
      badges.push(
        <span className="cal-badge cal-badge-overtime" key={`overtime-${index}`}>+{overtime.hours}h</span>,
      );
    }
  });
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

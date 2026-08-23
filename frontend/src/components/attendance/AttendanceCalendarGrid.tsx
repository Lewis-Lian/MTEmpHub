import { useMemo, useState, type ReactNode } from "react";
import type {
  AttendanceCalendarData,
  AttendanceCalendarDay,
  AttendanceCalendarLeave,
  AttendanceCalendarOvertime,
  DailyAttendanceOverrideValues,
} from "../../types/query";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface DayCell {
  date: string;
  dayOfMonth: number;
  day?: AttendanceCalendarDay;
  overtimes: AttendanceCalendarOvertime[];
  leaves: AttendanceCalendarLeave[];
}

interface AttendanceCalendarGridProps {
  data: AttendanceCalendarData;
  /** 外部选中日期（修正模式高亮），不传时组件内部自管理（明细弹层） */
  selectedDate?: string | null;
  /** 提供时点击格子走外部回调，不弹内部明细弹层 */
  onCellSelect?: (date: string) => void;
}

export default function AttendanceCalendarGrid({ data, selectedDate, onCellSelect }: AttendanceCalendarGridProps) {
  const [internalSelectedDate, setInternalSelectedDate] = useState<string | null>(null);
  const cells = useMemo(() => buildCells(data), [data]);
  // selectedDate 传入（含 null）即由外部控制高亮；未传时组件内部自管理
  const activeSelectedDate = selectedDate !== undefined ? selectedDate : internalSelectedDate;
  const selected = cells.find((cell) => cell.date === activeSelectedDate) ?? null;
  const hasMonthData = data.days.length > 0 || data.overtimes.length > 0 || data.leaves.length > 0;

  if (cells.length === 0) {
    return <div className="attendance-calendar attendance-calendar-empty">无效月份</div>;
  }

  function handleCellClick(date: string) {
    if (onCellSelect) {
      onCellSelect(date);
      return;
    }
    setInternalSelectedDate(date);
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
          const override = hasOverrideContent(cell.day?.override) ? cell.day?.override : null;
          return (
            <button
              aria-label={cell.date}
              className={`attendance-calendar-cell${cell.day || cell.overtimes.length > 0 || cell.leaves.length > 0 ? " has-data" : ""}${bgKey !== "none" ? ` is-bg-${bgKey}` : ""}${activeSelectedDate === cell.date ? " is-selected" : ""}`}
              key={cell.date}
              onClick={() => handleCellClick(cell.date)}
              type="button"
            >
              <div className="cal-day-number">{cell.dayOfMonth}</div>
              {renderPunchSummary(cell)}
              {bgKey === "absent" && <span className="cal-badge cal-badge-absent">缺勤</span>}
              {override && <span className="cal-badge cal-badge-override">修正</span>}
              {override?.is_evening_overtime && <span className="cal-badge cal-badge-evening">晚加</span>}
              {override?.status && !override.is_evening_overtime && (
                <span className={`cal-badge${LEAVE_STATUS_BG[override.status] ? " cal-badge-leave" : ""}`}>
                  {override.status}
                </span>
              )}
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

      {selected && (selected.day || selected.overtimes.length > 0 || selected.leaves.length > 0) && !onCellSelect ? (
        <div
          className="attendance-calendar-daydetail"
          onClick={() => setInternalSelectedDate(null)}
          role="dialog"
          aria-label={`考勤明细 ${selected.date}`}
        >
          <div className="daydetail-card" onClick={(event) => event.stopPropagation()}>
            <div className="daydetail-header">
              <div className="daydetail-date">
                <span>{selected.date}</span>
                <span className="daydetail-date-week">{weekdayLabel(selected.date)}</span>
              </div>
              <button aria-label="关闭" onClick={() => setInternalSelectedDate(null)} type="button">×</button>
            </div>
            <div className="daydetail-body">
              {selected.day ? (
                <>
                  <div className="daydetail-row">
                    <span className="daydetail-label">上班卡</span>
                    <span className="daydetail-value">{renderTimes(selected.day.check_in_times)}</span>
                  </div>
                  <div className="daydetail-row">
                    <span className="daydetail-label">下班卡</span>
                    <span className="daydetail-value">{renderTimes(selected.day.check_out_times)}</span>
                  </div>
                  <div className="daydetail-row">
                    <span className="daydetail-label">打卡次数</span>
                    <span className="daydetail-value">{selected.day.punch_count} 次</span>
                  </div>
                  <div className="daydetail-row">
                    <span className="daydetail-label">实出勤</span>
                    <span className="daydetail-value">{selected.day.actual_hours} 小时</span>
                  </div>
                  {selected.day.late_minutes > 0 && (
                    <div className="daydetail-row">
                      <span className="daydetail-label">迟到</span>
                      <span className="daydetail-value daydetail-warn">{selected.day.late_minutes} 分钟</span>
                    </div>
                  )}
                  {selected.day.early_leave_minutes > 0 && (
                    <div className="daydetail-row">
                      <span className="daydetail-label">早退</span>
                      <span className="daydetail-value daydetail-warn">{selected.day.early_leave_minutes} 分钟</span>
                    </div>
                  )}
                  {selected.day.is_half_day && (
                    <div className="daydetail-row">
                      <span className="daydetail-label">半勤</span>
                      <span className="daydetail-value">是</span>
                    </div>
                  )}
                </>
              ) : null}
              {selected.leaves.map((leave, index) => (
                <div className="daydetail-leave" key={`leave-${index}`}>
                  <div className="daydetail-row">
                    <span className="daydetail-label">{leave.leave_type}</span>
                    <span className="daydetail-value">
                      {leave.duration} 天{leave.approval_status ? `（${leave.approval_status}）` : ""}
                    </span>
                  </div>
                  {leave.start_time && leave.end_time ? (
                    <div className="daydetail-sub">{leave.start_time} ~ {leave.end_time}</div>
                  ) : null}
                  {leave.reason ? <div className="daydetail-sub">{leave.reason}</div> : null}
                </div>
              ))}
              {selected.overtimes.map((overtime, index) => (
                <div className="daydetail-row" key={`overtime-${index}`}>
                  <span className="daydetail-label">{overtimeLabel(overtime)}</span>
                  <span className="daydetail-value">{overtime.hours} 小时</span>
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

function weekdayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return "";
  }
  return WEEKDAYS[(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay() + 6) % 7];
}

function overtimeLabel(overtime: AttendanceCalendarOvertime): string {
  if (overtime.is_evening) return "晚上加班";
  if (overtime.is_holiday) return "节假日加班";
  if (overtime.is_weekend) return "周末加班";
  return "加班";
}

// 七色修订版背景色口径（设计文档 2.9）：出差 > 婚假 > 丧假 > 半勤 > 晚加班 > 出勤 > 缺勤 > 无
type CellBackgroundKey = "trip" | "marriage" | "funeral" | "half" | "evening" | "attendance" | "absent" | "leave" | "none";

// 有专属背景色的假种；其余假种统一用请假蓝
const LEAVE_STATUS_BG: Record<string, CellBackgroundKey> = {
  出差: "trip",
  婚假: "marriage",
  丧假: "funeral",
};

function hasOverrideContent(override: DailyAttendanceOverrideValues | null | undefined): boolean {
  if (!override) {
    return false;
  }
  return Boolean(
    override.status ||
      override.is_evening_overtime != null ||
      override.work_hours != null ||
      override.late_minutes != null ||
      override.early_leave_minutes != null ||
      (override.remark ?? "").trim(),
  );
}

// 逐日修正状态的背景映射：晚加 > 状态（出勤/半勤/缺勤/假种）> 无
function overrideBackgroundKey(override: DailyAttendanceOverrideValues): CellBackgroundKey {
  if (override.is_evening_overtime) return "evening";
  const status = override.status || "";
  if (status === "全勤") return "attendance";
  if (status === "上午出勤" || status === "下午出勤") return "half";
  if (status === "缺勤") return "absent";
  if (status) return LEAVE_STATUS_BG[status] ?? "leave";
  return "none";
}

function cellBackgroundKey(cell: DayCell, hasMonthData: boolean): CellBackgroundKey {
  const override = cell.day?.override;
  if (hasOverrideContent(override) && override) {
    const overrideKey = overrideBackgroundKey(override);
    if (overrideKey !== "none") {
      return overrideKey;
    }
  }
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
  // 同日同假种可能有多张 OA 单，格子徽章按假种去重展示
  Array.from(new Set(cell.leaves.map((leave) => leave.leave_type))).forEach((leaveType) => {
    badges.push(
      <span className="cal-badge cal-badge-leave" key={`leave-${leaveType}`}>{leaveType}</span>,
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

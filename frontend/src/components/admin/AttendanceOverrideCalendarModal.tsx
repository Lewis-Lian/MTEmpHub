import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  clearAdminDailyOverride,
  fetchAdminDailyOverrideCalendar,
  saveAdminDailyOverride,
  type DailyOverrideSavePayload,
} from "../../api/admin";
import AttendanceCalendarGrid from "../attendance/AttendanceCalendarGrid";
import ErrorState from "../feedback/ErrorState";
import LoadingState from "../feedback/LoadingState";
import { useNotification } from "../feedback/Notification";
import type { AttendanceCalendarData, DailyAttendanceOverrideValues } from "../../types/query";

// 状态枚举与后端 services/daily_override_service.py 保持一致
// 出勤类状态通过点击格子循环切换（ATTENDANCE_CYCLE），假种在下方面板选择
export const EMPLOYEE_LEAVE_STATUSES = ["病假", "工伤", "丧假", "事假", "补休（调休）", "婚假"];
export const MANAGER_LEAVE_STATUSES = ["工伤", "出差", "婚假", "丧假"];

// 快速连点合并为一次保存请求的等待窗口
const SAVE_DEBOUNCE_MS = 350;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 点击格子的出勤状态循环顺序：缺勤/无修正 → 全勤（回绕，不经过"跟随系统"；恢复跟随系统走清除修正）
const ATTENDANCE_CYCLE = ["全勤", "上午出勤", "下午出勤", "缺勤"];

function nextCycleStatus(current: string | null | undefined): string {
  const index = ATTENDANCE_CYCLE.indexOf(current ?? "");
  return ATTENDANCE_CYCLE[(index + 1) % ATTENDANCE_CYCLE.length];
}

interface OverrideCalendarEmployee {
  id: number;
  emp_no: string;
  name: string;
}

interface AttendanceOverrideCalendarModalProps {
  editTitle: string;
  employee: OverrideCalendarEmployee;
  month: string;
  isManager: boolean;
  isLocked: boolean;
  /** 外层列表行存在月度修正时提示：最终应用值以月度修正为准 */
  hasMonthlyOverride: boolean;
  onClose: () => void;
  onRowRefresh: (row: unknown) => void;
}

interface DetailFormState {
  workHours: string;
  lateMinutes: string;
  earlyLeaveMinutes: string;
  eveningOvertime: boolean;
  remark: string;
}

const EMPTY_FORM: DetailFormState = {
  workHours: "",
  lateMinutes: "",
  earlyLeaveMinutes: "",
  eveningOvertime: false,
  remark: "",
};

export default function AttendanceOverrideCalendarModal({
  editTitle,
  employee,
  month,
  isManager,
  isLocked,
  hasMonthlyOverride,
  onClose,
  onRowRefresh,
}: AttendanceOverrideCalendarModalProps) {
  const notification = useNotification();
  const [calendar, setCalendar] = useState<AttendanceCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(true);
  const [form, setForm] = useState<DetailFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const leaveStatuses = isManager ? MANAGER_LEAVE_STATUSES : EMPLOYEE_LEAVE_STATUSES;
  const selectedDay = useMemo(
    () => calendar?.days.find((day) => day.date === selectedDate) ?? null,
    [calendar, selectedDate],
  );
  const currentOverride = selectedDay?.override ?? null;

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setLoadError(null);
    setCalendar(null);
    setSelectedDate(null);
    setDetailExpanded(true);
    fetchAdminDailyOverrideCalendar(employee.id, month)
      .then((payload) => {
        if (mounted) {
          setCalendar(payload);
        }
      })
      .catch((caughtError: unknown) => {
        if (mounted) {
          setLoadError(caughtError instanceof Error ? caughtError.message : "日历数据加载失败");
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [employee.id, month]);

  // 选中日变化（或保存成功后数据刷新）时，用该日修正值重置表单
  useEffect(() => {
    setForm({
      workHours: currentOverride?.work_hours == null ? "" : String(currentOverride.work_hours),
      lateMinutes: currentOverride?.late_minutes == null ? "" : String(currentOverride.late_minutes),
      earlyLeaveMinutes: currentOverride?.early_leave_minutes == null ? "" : String(currentOverride.early_leave_minutes),
      eveningOvertime: Boolean(currentOverride?.is_evening_overtime),
      remark: currentOverride?.remark ?? "",
    });
    setDetailExpanded(true);
  }, [selectedDate, currentOverride]);

  function buildPayload(overrides: Partial<DailyOverrideSavePayload>): DailyOverrideSavePayload {
    return {
      month,
      emp_id: employee.id,
      date: selectedDate ?? "",
      work_hours: form.workHours,
      late_minutes: form.lateMinutes,
      early_leave_minutes: form.earlyLeaveMinutes,
      is_evening_overtime: form.eveningOvertime,
      remark: form.remark,
      ...overrides,
    };
  }

  // 乐观更新本地日历的某天修正值（不等保存响应，点击立即生效）
  function patchDayOverride(date: string, patch: Partial<DailyAttendanceOverrideValues>) {
    setCalendar((current) => {
      if (!current) {
        return current;
      }
      const days = current.days.map((day) =>
        day.date === date ? { ...day, override: { ...(day.override ?? {}), ...patch } } : day,
      );
      return { ...current, days };
    });
  }

  // 防抖保存：快速连点只发最后一次；保存成功用后端数据对齐，失败则重拉日历回滚
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ payload: DailyOverrideSavePayload; successText: string } | null>(null);

  function scheduleSave(payload: DailyOverrideSavePayload, successText: string) {
    pendingSaveRef.current = { payload, successText };
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) {
      return;
    }
    pendingSaveRef.current = null;
    setIsSaving(true);
    try {
      const response = await saveAdminDailyOverride<unknown>(pending.payload);
      setCalendar(response.calendar);
      onRowRefresh(response.row);
      notification.success(pending.successText);
    } catch (caughtError: unknown) {
      notification.error(caughtError instanceof Error ? caughtError.message : "保存失败");
      try {
        setCalendar(await fetchAdminDailyOverrideCalendar(employee.id, month));
      } catch {
        // 重拉失败时保留本地状态，用户可手动刷新
      }
    } finally {
      setIsSaving(false);
    }
  }

  // 弹窗关闭/卸载前把未落盘的防抖修正发出（fire-and-forget）
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void saveAdminDailyOverride<unknown>(pending.payload).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 首次点击格子仅选中（展开当天信息），再次点击同一格才循环切换出勤状态；假种在下方面板设置
  function handleCellClick(date: string) {
    const isFirstClick = selectedDate !== date;
    setSelectedDate(date);
    if (isFirstClick || isLocked || !calendar) {
      return;
    }
    const dayOverride = calendar.days.find((day) => day.date === date)?.override ?? null;
    const nextStatus = nextCycleStatus(dayOverride?.status);
    patchDayOverride(date, { status: nextStatus });
    scheduleSave(
      {
        month,
        emp_id: employee.id,
        date,
        status: nextStatus,
        is_evening_overtime: dayOverride?.is_evening_overtime ?? undefined,
        work_hours: dayOverride?.work_hours ?? "",
        late_minutes: dayOverride?.late_minutes ?? "",
        early_leave_minutes: dayOverride?.early_leave_minutes ?? "",
        remark: dayOverride?.remark ?? "",
      },
      `已标记 ${nextStatus}`,
    );
  }

  async function handleClear() {
    if (!selectedDate || isSaving) {
      return;
    }
    // 丢弃未落盘的防抖保存，避免清除后又落下一条写回修正
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    setIsSaving(true);
    try {
      const response = await clearAdminDailyOverride<unknown>(employee.id, selectedDate);
      setCalendar(response.calendar);
      onRowRefresh(response.row);
      notification.success("已恢复系统口径");
    } catch (caughtError: unknown) {
      notification.error(caughtError instanceof Error ? caughtError.message : "清除失败");
    } finally {
      setIsSaving(false);
    }
  }

  function renderModal() {
    return (
      <div aria-label={editTitle} aria-modal="true" className="master-modal-backdrop attendance-override-edit-backdrop" role="dialog">
        <div className="master-modal attendance-override-calendar-modal">
          <div className="master-modal-header">
            <div>
              <h2>{editTitle}</h2>
              <div className="attendance-override-edit-meta">
                {`${employee.emp_no} - ${employee.name} / ${month || "-"}`}
              </div>
            </div>
            <button aria-label="关闭" className="master-modal-close" onClick={onClose} type="button">
              ×
            </button>
          </div>
          <div className="master-modal-body attendance-override-calendar-body">
            {hasMonthlyOverride ? (
              <div className="attendance-override-calendar-notice">
                该月存在月度手工修正（Excel 导入），最终应用值以月度修正为准
              </div>
            ) : null}
            {isLocked ? (
              <div className="account-lock-notice is-locked">{month || "-"} 账套已锁定，仅可查看</div>
            ) : null}
            {isLoading ? (
              <LoadingState message="正在加载考勤日历..." />
            ) : loadError ? (
              <ErrorState description={loadError} title="日历数据加载失败" />
            ) : calendar ? (
              <div className="attendance-override-calendar-layout">
                <div className="attendance-override-calendar-main">
                  <AttendanceCalendarGrid
                    data={calendar}
                    onCellSelect={handleCellClick}
                    selectedDate={selectedDate}
                  />
                </div>
                <aside className="attendance-override-calendar-side">
                  {selectedDay ? renderDayPanel() : (
                    <div aria-hidden="true" className="daypanel-skeleton">
                      <span className="daypanel-skeleton-title" />
                      <span className="daypanel-skeleton-row" />
                      <span className="daypanel-skeleton-row daypanel-skeleton-row--short" />
                      <span className="daypanel-skeleton-row" />
                      <div className="daypanel-skeleton-block">
                        <span className="daypanel-skeleton-chip" />
                        <span className="daypanel-skeleton-chip" />
                        <span className="daypanel-skeleton-chip" />
                        <span className="daypanel-skeleton-chip" />
                      </div>
                      <div className="daypanel-skeleton-block">
                        <span className="daypanel-skeleton-field" />
                        <span className="daypanel-skeleton-field" />
                        <span className="daypanel-skeleton-field daypanel-skeleton-field--wide" />
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderDayPanel() {
    if (!selectedDay) {
      return null;
    }
    const hasOverrideContent = Boolean(
      currentOverride &&
        (currentOverride.status ||
          currentOverride.is_evening_overtime != null ||
          currentOverride.work_hours != null ||
          currentOverride.late_minutes != null ||
          currentOverride.early_leave_minutes != null ||
          (currentOverride.remark ?? "").trim()),
    );
    return (
      <div className="attendance-override-daypanel" data-testid="daily-override-panel">
        <div className="daypanel-section daypanel-detail">
          <div className="daypanel-title">
            <span>{selectedDate}</span>
            <span className="daydetail-date-week">{weekdayLabel(selectedDate ?? "")}</span>
            <span className="daypanel-title-hint">原始考勤</span>
          </div>
          <div className="daypanel-rows">
            <div className="daydetail-row">
              <span className="daydetail-label">上班卡</span>
              <span className="daydetail-value">{selectedDay.check_in_times.join(" / ") || "无"}</span>
            </div>
            <div className="daydetail-row">
              <span className="daydetail-label">下班卡</span>
              <span className="daydetail-value">{selectedDay.check_out_times.join(" / ") || "无"}</span>
            </div>
            <div className="daydetail-row">
              <span className="daydetail-label">打卡次数</span>
              <span className="daydetail-value">{selectedDay.punch_count} 次</span>
            </div>
            <div className="daydetail-row">
              <span className="daydetail-label">实出勤</span>
              <span className="daydetail-value">{selectedDay.actual_hours} 小时</span>
            </div>
            {selectedDay.late_minutes > 0 && (
              <div className="daydetail-row">
                <span className="daydetail-label">迟到</span>
                <span className="daydetail-value daydetail-warn">{selectedDay.late_minutes} 分钟</span>
              </div>
            )}
            {selectedDay.early_leave_minutes > 0 && (
              <div className="daydetail-row">
                <span className="daydetail-label">早退</span>
                <span className="daydetail-value daydetail-warn">{selectedDay.early_leave_minutes} 分钟</span>
              </div>
            )}
          </div>
        </div>

        <div className="daypanel-section daypanel-status">
          <div className="daypanel-title">
            <span>假种（点击即保存；出勤状态点格子循环切换）</span>
            <span className="daypanel-current-status">{`当前：${currentOverride?.status || "跟随系统"}`}</span>
          </div>
          <div className="daypanel-status-group">
            {leaveStatuses.map((status) => (
              <button
                aria-label={`标记 ${status}`}
                className={`daypanel-status-button${currentOverride?.status === status ? " is-active" : ""}`}
                disabled={isLocked || isSaving}
                key={status}
                onClick={() => {
                  patchDayOverride(selectedDate ?? "", { status });
                  scheduleSave(buildPayload({ status }), `已标记 ${status}`);
                }}
                type="button"
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="daypanel-section daypanel-extra">
          <div className="daypanel-extra-header">
            <button
              className="daypanel-toggle"
              onClick={() => setDetailExpanded((current) => !current)}
              type="button"
            >
              更多信息{detailExpanded ? "▲" : "▼"}
            </button>
            {hasOverrideContent ? (
              <button
                className="account-action-button"
                disabled={isLocked || isSaving}
                onClick={() => void handleClear()}
                type="button"
              >
                清除修正
              </button>
            ) : null}
          </div>
          {detailExpanded ? (
            <div className="daypanel-extra-form">
              <label className="daypanel-field daypanel-field--check" title="确认晚上加班后按 0.5 天出勤计">
                <input
                  checked={form.eveningOvertime}
                  disabled={isLocked || isSaving}
                  onChange={(event) => setForm((current) => ({ ...current, eveningOvertime: event.target.checked }))}
                  type="checkbox"
                />
                <span className="daypanel-field-label">晚上加班</span>
                <span className="daypanel-field-sub">0.5 出勤</span>
              </label>
              <label className="daypanel-field">
                <span className="daypanel-field-label">工时（小时）</span>
                <input
                  disabled={isLocked || isSaving}
                  inputMode="decimal"
                  onChange={(event) => setForm((current) => ({ ...current, workHours: event.target.value }))}
                  placeholder="自动"
                  value={form.workHours}
                />
              </label>
              <label className="daypanel-field">
                <span className="daypanel-field-label">迟到分钟</span>
                <input
                  disabled={isLocked || isSaving}
                  inputMode="numeric"
                  onChange={(event) => setForm((current) => ({ ...current, lateMinutes: event.target.value }))}
                  placeholder="自动"
                  value={form.lateMinutes}
                />
              </label>
              <label className="daypanel-field">
                <span className="daypanel-field-label">早退分钟</span>
                <input
                  disabled={isLocked || isSaving}
                  inputMode="numeric"
                  onChange={(event) => setForm((current) => ({ ...current, earlyLeaveMinutes: event.target.value }))}
                  placeholder="自动"
                  value={form.earlyLeaveMinutes}
                />
              </label>
              <label className="daypanel-field daypanel-field-wide">
                <span className="daypanel-field-label">备注</span>
                <textarea
                  disabled={isLocked || isSaving}
                  onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
                  placeholder="可填写修正原因"
                  rows={2}
                  value={form.remark}
                />
              </label>
              <div className="daypanel-actions">
                <button
                  className="account-action-button account-action-button--primary"
                  disabled={isLocked || isSaving}
                  onClick={() => {
                    if (selectedDate) {
                      patchDayOverride(selectedDate, {
                        work_hours: form.workHours === "" ? null : Number(form.workHours),
                        late_minutes: form.lateMinutes === "" ? null : Number(form.lateMinutes),
                        early_leave_minutes: form.earlyLeaveMinutes === "" ? null : Number(form.earlyLeaveMinutes),
                        is_evening_overtime: form.eveningOvertime,
                        remark: form.remark,
                      });
                    }
                    scheduleSave(buildPayload({ status: currentOverride?.status ?? "" }), "已保存修正");
                  }}
                  type="button"
                >
                  保存修正
                </button>
              </div>
            </div>
          ) : null}
          {currentOverride?.updated_at ? (
            <div className="attendance-override-daypanel-meta">
              {`最近修正 ${(currentOverride.updated_by_name || "").trim()} ${formatDateTime(currentOverride.updated_at)}`.trim()}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return createPortal(renderModal(), document.body);
}

function weekdayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return "";
  }
  return WEEKDAYS[new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()];
}

function formatDateTime(value: string): string {
  return value ? value.replace("T", " ").slice(0, 19) : "";
}

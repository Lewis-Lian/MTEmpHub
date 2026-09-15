import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchAttendanceCalendar, fetchHeaderRows, fetchQueryBootstrap } from "../../api/query";
import AttendanceCalendarGrid from "../../components/attendance/AttendanceCalendarGrid";
import AccountSetSelector from "../../components/query/AccountSetSelector";
import EmployeePicker from "../../components/query/EmployeePicker";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { AttendanceCalendarData, HeaderRowsResponse, QueryBootstrap, QueryEmployee } from "../../types/query";
import "./individual-attendance.css";

export default function IndividualAttendancePage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [summary, setSummary] = useState<HeaderRowsResponse | null>(null);
  const [calendar, setCalendar] = useState<AttendanceCalendarData | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);

  useEffect(() => {
    fetchQueryBootstrap()
      .then((payload) => {
        setBootstrap(payload);
        setMonth(payload.account_sets.find((item) => item.is_active)?.month ?? payload.account_sets[0]?.month ?? "");
      })
      .catch((caughtError) => setError(caughtError instanceof ApiError ? caughtError.message : "单人考勤查询页初始化失败"))
      .finally(() => setIsLoading(false));
  }, []);

  const selectedEmployee = useMemo(
    () => bootstrap?.employees.find((employee) => employee.id === employeeId) ?? null,
    [bootstrap, employeeId],
  );

  async function handleQuery() {
    if (!selectedEmployee || !month) {
      setError("请选择人员和账套月份");
      return;
    }
    setIsQuerying(true);
    setError("");
    try {
      const query = new URLSearchParams({ month });
      query.set("emp_ids", String(selectedEmployee.id));
      const endpoint = selectedEmployee.is_manager ? "/api/query/manager-attendance" : "/api/query/employee-dashboard";
      const payload = await fetchHeaderRows(endpoint, query);
      setSummary(payload);
      const calendarPayload = await fetchAttendanceCalendar(selectedEmployee.id, month);
      setCalendar(calendarPayload);
    } catch (caughtError) {
      setSummary(null);
      setCalendar(null);
      setError(caughtError instanceof ApiError ? caughtError.message : "查询失败，请稍后重试");
    } finally {
      setIsQuerying(false);
    }
  }

  if (isLoading) return <LoadingState filterFields={2} message="正在准备个人考勤查询页..." variant="query-page" />;
  if (error && !bootstrap) return <ErrorState description={error} title="个人考勤查询页初始化失败" />;
  if (!bootstrap) return <ErrorState description="未能读取个人考勤查询页基础数据。" />;

  return (
    <div className="individual-attendance-page employee-dashboard-page query-page-shell">
      {/* 极光背景流动球 */}
      <div className="qh-glow-sphere sphere-1" />
      <div className="qh-glow-sphere sphere-2" />
      <div className="qh-glow-sphere sphere-3" />

      {/* 顶部紧凑型控制栏：标题上下行，人员/账套选择器右对齐且保留呼吸间隔 */}
      <aside className="query-filter-rail individual-filter-rail">
        <div className="individual-filter-toolbar">
          <div className="individual-filter-title-group">
            <span className="query-filter-kicker">Attendance</span>
            <h2>个人考勤查询</h2>
          </div>

          <div className="individual-filter-controls">
            <div className="query-filter-field individual-filter-emp">
              <label className="form-label">人员</label>
              <EmployeePicker
                departments={bootstrap.departments}
                employees={bootstrap.employees}
                filterMode="all"
                label="员工或管理人员"
                onChange={(ids) => {
                  setEmployeeId(ids[0] ?? null);
                  setSummary(null);
                  setCalendar(null);
                }}
                selectedIds={employeeId ? [employeeId] : []}
                showFieldChrome={false}
                singleSelect
              />
            </div>

            <div className="query-filter-field individual-filter-month">
              <AccountSetSelector accountSets={bootstrap.account_sets} compact label="账套" onChange={setMonth} value={month} />
            </div>

            <div className="query-filter-actions individual-filter-actions">
              <button className="btn btn-primary btn-query-action" disabled={isQuerying || !employeeId} onClick={handleQuery} type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>{isQuerying ? "查询中..." : "查询"}</span>
              </button>
            </div>
          </div>
        </div>
        {error ? <p className="legacy-inline-error">{error}</p> : null}
      </aside>

      {/* 核心看板工作区 */}
      <main className={`individual-attendance-workspace`}>
        {selectedEmployee && summary && calendar ? (
          <AttendanceResult employee={selectedEmployee} summary={summary} calendar={calendar} />
        ) : (
          <div className="individual-attendance-empty">
            <div className="empty-visual-badge">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <rect x="15" y="4" width="7" height="6" rx="1" />
              </svg>
            </div>
            <div className="empty-text-wrap">
              <div className="empty-title">请选择人员后点击查询</div>
              <div className="empty-desc">在上方右侧选择人员及对应账套，即可开启多维考勤数据看板分析。</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AttendanceResult({ employee, summary, calendar }: { employee: QueryEmployee; summary: HeaderRowsResponse; calendar: AttendanceCalendarData }) {
  const [detailTab, setDetailTab] = useState<"punch" | "leave" | "overtime">("punch");
  const [isDetailFullscreen, setIsDetailFullscreen] = useState(false);

  // 全屏弹窗支持 ESC 键快捷关闭
  useEffect(() => {
    if (!isDetailFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDetailFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDetailFullscreen]);

  const attendanceDays = calendar.summary?.attendance_days ?? 0;
  const halfDays = calendar.summary?.half_days ?? 0;
  const lateMinutes = calendar.summary?.late_minutes_total ?? 0;
  const earlyLeaveMinutes = calendar.summary?.early_leave_minutes_total ?? 0;
  const totalLeaveDays = calendar.leaves.reduce((sum, item) => sum + item.duration, 0);
  const leaveCount = calendar.leaves.length;
  const eveningOt = calendar.summary?.evening_overtime_hours ?? 0;
  const otherOt = calendar.summary?.other_overtime_hours ?? 0;
  const totalOtHours = eveningOt + otherOt;

  // 计算异常打卡天数/次数（根据业务规范精确定义为一天打卡1次、3次的次数）
  const abnormalPunchDays = calendar.days.filter(
    (day) => day.punch_count === 1 || day.punch_count === 3
  );
  const abnormalPunchCount = abnormalPunchDays.length;

  // 打卡明细：展示统一的「打卡数据」
  const punchRows = calendar.days
    .filter((day) => day.punch_count > 0 || Boolean(day.exception_reason))
    .map((day) => {
      const punches = Array.from(new Set([...day.check_in_times, ...day.check_out_times]))
        .filter(Boolean)
        .sort()
        .join("、") || (day.punch_count > 0 ? `${day.punch_count} 次打卡` : "-");
      const isOdd = day.punch_count === 1 || day.punch_count === 3;
      const cleanReason = (day.exception_reason || "").replace(/旷工/g, "缺勤");
      const abnormalNote = isOdd ? `打卡${day.punch_count}次` : (cleanReason || "-");

      return [
        day.date,
        punches,
        `${day.punch_count} 次`,
        `${day.late_minutes} 分钟`,
        `${day.early_leave_minutes} 分钟`,
        abnormalNote,
      ];
    });

  const leaveRows = calendar.leaves.map((leave) => [
    leave.date,
    leave.leave_type,
    `${leave.duration} 天`,
    leave.reason || "-",
  ]);

  const overtimeRows = calendar.overtimes.map((overtime) => [
    overtime.date,
    overtime.is_evening ? "晚间加班" : "其他加班",
    `${overtime.hours} 小时`,
  ]);

  return (
    <div className={`individual-attendance-result ${isDetailFullscreen ? "has-fullscreen-panel" : ""}`}>
      {/* 顶部横幅：人员档案与快捷标签 */}
      <header className="individual-attendance-header">
        <div className="profile-header-main">
          <div className={`profile-avatar ${employee.is_manager ? "is-manager" : "is-employee"}`}>
            {employee.name.slice(0, 1)}
          </div>
          <div className="profile-info">
            <div className="profile-top-line">
              <span className="query-filter-kicker">Profile Overview</span>
              <span className={`profile-badge ${employee.is_manager ? "badge-manager" : "badge-employee"}`}>
                {employee.is_manager ? "管理人员" : "员工"}
              </span>
            </div>
            <h1>{employee.name} · {employee.is_manager ? "管理人员" : "员工"}</h1>
            <p className="profile-meta-text">{employee.emp_no} · {employee.dept_name || "未分配部门"} · {calendar.month}</p>
            <div className="profile-tags">
              <span className="profile-tag">工号: {employee.emp_no}</span>
              <span className="profile-tag">部门: {employee.dept_name || "未分配部门"}</span>
              <span className="profile-tag tag-month">账套: {calendar.month}</span>
              <span className={`profile-tag ${abnormalPunchCount > 0 ? "tag-abnormal" : ""}`}>
                异常打卡: {abnormalPunchCount} 次
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 5 栏核心考勤指标看板（简约大气、无顶部粗线、去除花哨图标） */}
      <div className="individual-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-title">出勤天数</span>
          </div>
          <div className="kpi-card-value">
            {attendanceDays} <span className="kpi-card-unit">天</span>
          </div>
          <div className="kpi-card-foot">
            {halfDays > 0 ? `半天出勤 ${halfDays} 天` : "出勤状态正常"}
          </div>
        </div>

        <div className={`kpi-card ${abnormalPunchCount > 0 ? "kpi-card-warn" : ""}`}>
          <div className="kpi-card-header">
            <span className="kpi-card-title">异常打卡</span>
          </div>
          <div className="kpi-card-value">
            {abnormalPunchCount} <span className="kpi-card-unit">次</span>
          </div>
          <div className="kpi-card-foot">
            {abnormalPunchCount > 0 ? `异常打卡共 ${abnormalPunchCount} 次` : "全月无异常打卡"}
          </div>
        </div>

        <div className={`kpi-card ${lateMinutes > 0 || earlyLeaveMinutes > 0 ? "kpi-card-warn" : ""}`}>
          <div className="kpi-card-header">
            <span className="kpi-card-title">迟到 / 早退</span>
          </div>
          <div className="kpi-card-value">
            {lateMinutes + earlyLeaveMinutes} <span className="kpi-card-unit">分钟</span>
          </div>
          <div className="kpi-card-foot">
            迟到 {lateMinutes} 分钟 · 早退 {earlyLeaveMinutes} 分钟
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-title">请假统计</span>
          </div>
          <div className="kpi-card-value">
            {totalLeaveDays} <span className="kpi-card-unit">天</span>
          </div>
          <div className="kpi-card-foot">
            共 {leaveCount} 次请假申请
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-title">加班累计</span>
          </div>
          <div className="kpi-card-value">
            {totalOtHours} <span className="kpi-card-unit">小时</span>
          </div>
          <div className="kpi-card-foot">
            晚间 {eveningOt}h · 节假日/其他 {otherOt}h
          </div>
        </div>
      </div>

      {/* 中部核心对照看板：日历正方形格子 (左) + 联动明细 (右，右上角提供全屏放大图标按钮) */}
      <div className="individual-dashboard-middle">
        {/* 左侧：考勤日历卡片 */}
        <section className="individual-attendance-section individual-calendar-card" aria-label="考勤日历">
          <div className="dashboard-card-top">
            <SectionTitle icon="calendar">考勤日历</SectionTitle>
            <span className="dashboard-card-tag">{calendar.month} 出勤视图</span>
          </div>
          <div className="individual-calendar-container">
            <AttendanceCalendarGrid data={calendar} showOverrideDot={false} />
          </div>
        </section>

        {/* 全屏弹窗虚化背景 (点击虚化背景可关闭还原) */}
        {isDetailFullscreen && (
          <div
            aria-hidden="true"
            className="individual-detail-backdrop"
            onClick={() => setIsDetailFullscreen(false)}
          />
        )}

        {/* 右侧：明细 Tab 对照卡片（右上角提供纯图标全屏/弹窗放大按钮） */}
        <section
          className={`individual-attendance-section individual-details-card individual-attendance-details ${
            isDetailFullscreen ? "is-fullscreen" : ""
          }`}
          aria-label="考勤明细"
        >
          <div className="dashboard-card-top">
            <SectionTitle icon="details">考勤明细</SectionTitle>
            <button
              aria-label={isDetailFullscreen ? "还原窗口" : "放大到页面内全屏"}
              className={`btn-fullscreen-toggle ${isDetailFullscreen ? "is-active" : ""}`}
              onClick={() => setIsDetailFullscreen(!isDetailFullscreen)}
              title={isDetailFullscreen ? "还原窗口" : "放大到页面内全屏"}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                {isDetailFullscreen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" x2="14" y1="3" y2="10" />
                    <line x1="3" x2="10" y1="21" y2="14" />
                  </>
                )}
              </svg>
            </button>
          </div>

          <div className="dashboard-segmented-tabs" role="tablist">
            <button
              aria-selected={detailTab === "punch"}
              className={`segmented-tab-btn ${detailTab === "punch" ? "is-active" : ""}`}
              onClick={() => setDetailTab("punch")}
              role="tab"
              type="button"
            >
              打卡明细
              <span className="segmented-counter">{punchRows.length}</span>
            </button>
            <button
              aria-selected={detailTab === "leave"}
              className={`segmented-tab-btn ${detailTab === "leave" ? "is-active" : ""}`}
              onClick={() => setDetailTab("leave")}
              role="tab"
              type="button"
            >
              请假明细
              <span className="segmented-counter">{leaveRows.length}</span>
            </button>
            <button
              aria-selected={detailTab === "overtime"}
              className={`segmented-tab-btn ${detailTab === "overtime" ? "is-active" : ""}`}
              onClick={() => setDetailTab("overtime")}
              role="tab"
              type="button"
            >
              加班明细
              <span className="segmented-counter">{overtimeRows.length}</span>
            </button>
          </div>

          <div className="dashboard-tab-panel">
            {detailTab === "punch" && (
              <DetailTable
                headers={["日期", "打卡数据", "打卡次数", "迟到", "早退", "异常原因"]}
                rows={punchRows}
                type="punch"
              />
            )}
            {detailTab === "leave" && (
              <DetailTable
                headers={["日期", "请假类型", "时长", "事由"]}
                rows={leaveRows}
                type="leave"
              />
            )}
            {detailTab === "overtime" && (
              <DetailTable
                headers={["日期", "类型", "时长"]}
                rows={overtimeRows}
                type="overtime"
              />
            )}
          </div>
        </section>
      </div>

      {/* 底部全宽卡片：月度考勤汇总 */}
      <section className="individual-attendance-section individual-summary-card" aria-label="月度考勤汇总">
        <div className="dashboard-card-top">
          <SectionTitle icon="summary">月度考勤汇总</SectionTitle>
          <span className="dashboard-card-tag">{summary.rows.length} 条记录</span>
        </div>
        <SummaryTable summary={summary} />
      </section>
    </div>
  );
}

function SectionTitle({ children, icon }: { children: string; icon: "summary" | "calendar" | "details" }) {
  return (
    <h2 className="individual-attendance-section-title">
      <span aria-hidden="true" className={`individual-attendance-section-icon icon-${icon}`} data-testid="section-icon" />
      {children}
    </h2>
  );
}

function SummaryTable({ summary }: { summary: HeaderRowsResponse }) {
  const safeHeaders = summary.headers.map((h) => h.replace(/旷工/g, "缺勤"));
  const safeRows = summary.rows.map((row) =>
    row.map((value) => String(value ?? "-").replace(/旷工/g, "缺勤"))
  );
  return (
    <DetailTable
      headers={safeHeaders}
      rows={safeRows}
      type="summary"
    />
  );
}

function DetailTable({
  headers,
  rows,
  type = "default",
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
  type?: "summary" | "punch" | "leave" | "overtime" | "default";
}) {
  return (
    <div className={`individual-attendance-detail-table detail-table-${type}`}>
      <div className="legacy-table-wrap individual-table-wrap">
        <table className="legacy-table individual-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th className="legacy-table-head-cell" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index}>
                  {row.map((value, cellIndex) => {
                    const strVal = String(value);
                    const isLateOrEarly = type === "punch" && (cellIndex === 3 || cellIndex === 4);
                    const isNonZeroPenalty = isLateOrEarly && strVal !== "0 分钟" && strVal !== "-";
                    const isAbnormalReason = type === "punch" && cellIndex === 5 && strVal !== "-";
                    const isLeavePill = type === "leave" && cellIndex === 1;
                    const isOvertimePill = type === "overtime" && cellIndex === 1;

                    return (
                      <td className="legacy-table-body-cell" key={`${index}-${cellIndex}`}>
                        {isNonZeroPenalty || isAbnormalReason ? (
                          <span className="status-pill pill-warn">{strVal}</span>
                        ) : isLeavePill ? (
                          <span className="status-pill pill-leave">{strVal}</span>
                        ) : isOvertimePill ? (
                          <span className="status-pill pill-overtime">{strVal}</span>
                        ) : (
                          strVal
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td className="legacy-table-body-cell empty-table-cell" colSpan={headers.length}>
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

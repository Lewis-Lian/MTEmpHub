import { useEffect, useRef, useState } from "react";

import {
  fetchAttendanceSettings,
  saveAttendanceSettings,
  testAttendanceConnection,
  testCardDbConnection,
  fetchAccountSets,
  syncManagerAttendance,
  syncEmployeeAttendance,
  fetchManagerAttendanceSyncHistory,
  fetchEmployeeAttendanceSyncHistory,
  fetchSyncProgress,
  managerAttendanceUnmatchedCsvUrl,
  cardAttendanceUnmatchedCsvUrl,
  type AdminAttendanceSettings,
  type CardDbConfig,
  type ManagerAttendanceSyncResult,
} from "../../api/admin";
import { fetchMe, type AuthUser } from "../../api/auth";
import QueryTable from "../../components/query/QueryTable";
import { useNotification } from "../../components/feedback/Notification";

const EMPTY_CARD_FORM = { host: "", port: "", database: "", user: "", password: "" };
type CardDbForm = typeof EMPTY_CARD_FORM;

export default function AttendanceSourceSettingsPage() {
  const notification = useNotification();
  const [attendanceSettings, setAttendanceSettings] = useState<AdminAttendanceSettings | null>(null);
  const [attendanceAccounts, setAttendanceAccounts] = useState<Array<{ id: number; month: string; name: string; is_active?: boolean }>>([]);
  const [selectedAttendanceAccount, setSelectedAttendanceAccount] = useState<number | null>(null);
  const [selectedEmployeeAccount, setSelectedEmployeeAccount] = useState<number | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceSyncing, setAttendanceSyncing] = useState(false);
  const [attendanceResult, setAttendanceResult] = useState<ManagerAttendanceSyncResult | null>(null);
  const [attendanceError, setAttendanceError] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const requestSequence = useRef(0);
  const [cardDbForm, setCardDbForm] = useState<CardDbForm>(EMPTY_CARD_FORM);
  const [cardDbSaving, setCardDbSaving] = useState(false);
  const [cardDbTesting, setCardDbTesting] = useState(false);
  const [employeeSyncing, setEmployeeSyncing] = useState(false);
  const [employeeResult, setEmployeeResult] = useState<ManagerAttendanceSyncResult | null>(null);
  const [employeeHistoryLoading, setEmployeeHistoryLoading] = useState(false);
  const [employeeHistoryError, setEmployeeHistoryError] = useState("");
  const employeeSequence = useRef(0);
  const cardFormSeeded = useRef(false);
  const employeePollRef = useRef<any>(null);
  const managerPollRef = useRef<any>(null);
  const [employeeProgress, setEmployeeProgress] = useState<{ active: boolean; percent: number; stage: string }>({
    active: false,
    percent: 0,
    stage: "",
  });
  const [managerProgress, setManagerProgress] = useState<{ active: boolean; percent: number; stage: string }>({
    active: false,
    percent: 0,
    stage: "",
  });

  useEffect(() => {
    return () => {
      if (employeePollRef.current) clearInterval(employeePollRef.current);
      if (managerPollRef.current) clearInterval(managerPollRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setAttendanceLoading(true);
    setAttendanceError("");
    fetchAttendanceSettings()
      .then((attendance) => { if (active) setAttendanceSettings(attendance); })
      .catch((err: any) => {
        if (!active) return;
        if (err?.status === 401 || err?.status === 403) {
          setAuthUser(null);
          setAuthChecked(true);
        }
        setAttendanceError(err instanceof Error ? err.message : "考勤设置加载失败");
      })
      .finally(() => { if (active) setAttendanceLoading(false); });
    fetchMe()
      .then((user) => {
        if (!active) return;
        setAuthUser(user);
        if (user.role !== "admin") return;
        fetchAccountSets()
          .then((accounts) => {
            if (!active) return;
            setAttendanceAccounts(accounts);
            const activeId = accounts.find((account) => account.is_active)?.id ?? accounts[0]?.id ?? null;
            setSelectedAttendanceAccount(activeId);
            setSelectedEmployeeAccount(activeId);
          })
          .catch((err: any) => {
            if (!active) return;
            if (err?.status === 401 || err?.status === 403) {
              setAuthUser(null);
              setAuthChecked(true);
            }
            setAttendanceError(err instanceof Error ? err.message : "账套加载失败");
          });
      })
      .catch(() => { if (active) setAuthUser(null); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // 仅首次加载回填表单；保存后的响应不覆盖用户正在编辑的内容
    if (!attendanceSettings || cardFormSeeded.current) return;
    cardFormSeeded.current = true;
    setCardDbForm({
      host: attendanceSettings.card_db?.host ?? "",
      port: String(attendanceSettings.card_db?.port ?? ""),
      database: attendanceSettings.card_db?.database ?? "",
      user: attendanceSettings.card_db?.user ?? "",
      password: "",
    });
  }, [attendanceSettings]);

  function handleAdminApiError(err: any, defaultMsg: string) {
    if (err?.status === 401 || err?.status === 403) {
      setAuthUser(null);
      setAuthChecked(true);
      notification.warning("管理员登录已过期，请重新登录");
    } else {
      notification.error(err instanceof Error ? err.message : defaultMsg);
    }
  }

  // 失败响应把原因放在 message 字段（不是通用 client 认的 error 字段），
  // 优先展示它，避免只看到 "Bad Gateway" 这类状态文字
  function cardErrorMessage(err: any, fallback: string): string {
    const details = err?.details;
    const message = details && typeof details === "object" ? (details as { message?: unknown }).message : undefined;
    if (typeof message === "string" && message.trim()) return message;
    return err instanceof Error && err.message ? err.message : fallback;
  }

  async function handleAttendanceSourceChange(source: AdminAttendanceSettings["manager_attendance_source"]) {
    if (!attendanceSettings || source === attendanceSettings.manager_attendance_source) return;
    setAttendanceSaving(true);
    try {
      const result = await saveAttendanceSettings(source);
      setAttendanceSettings(result);
      notification.success("考勤数据源已保存");
    } catch (err: any) {
      handleAdminApiError(err, "保存考勤数据源失败");
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function handleEmployeeSourceChange(source: AdminAttendanceSettings["employee_attendance_source"]) {
    if (!attendanceSettings || source === attendanceSettings.employee_attendance_source) return;
    setAttendanceSaving(true);
    try {
      const result = await saveAttendanceSettings(attendanceSettings.manager_attendance_source, {
        employee_attendance_source: source,
      });
      setAttendanceSettings(result);
      notification.success("员工考勤数据源已保存");
    } catch (err: any) {
      handleAdminApiError(err, "保存员工考勤数据源失败");
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function handleAttendanceConnectionTest() {
    setAttendanceLoading(true);
    try {
      const result = await testAttendanceConnection();
      notification[result.ok ? "success" : "error"](result.message || (result.ok ? "钉钉连接成功" : "连接失败"));
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        handleAdminApiError(err, "连接测试失败");
        return;
      }
      const message = err instanceof Error ? err.message : "连接测试失败";
      notification.error(/secret|token|client[_-]?id|corp[_-]?id/i.test(message) ? "连接测试失败，请检查钉钉配置" : message);
    } finally {
      setAttendanceLoading(false);
    }
  }

  function cardDbPayload(includePassword: boolean): CardDbConfig {
    const payload: CardDbConfig = {};
    if (cardDbForm.host.trim()) payload.host = cardDbForm.host.trim();
    if (cardDbForm.port.trim()) payload.port = cardDbForm.port.trim();
    if (cardDbForm.database.trim()) payload.database = cardDbForm.database.trim();
    if (cardDbForm.user.trim()) payload.user = cardDbForm.user.trim();
    if (includePassword && cardDbForm.password) payload.password = cardDbForm.password;
    return payload;
  }

  async function handleCardDbSave() {
    if (!attendanceSettings) return;
    setCardDbSaving(true);
    try {
      const result = await saveAttendanceSettings(attendanceSettings.manager_attendance_source, {
        card_db: cardDbPayload(true),
      });
      setAttendanceSettings(result);
      notification.success("考勤机连接参数已保存");
    } catch (err: any) {
      handleAdminApiError(err, "保存考勤机连接参数失败");
    } finally {
      setCardDbSaving(false);
    }
  }

  async function handleCardDbTest() {
    setCardDbTesting(true);
    try {
      const result = await testCardDbConnection({ ...cardDbPayload(false), password: cardDbForm.password });
      notification[result.ok ? "success" : "error"](result.message || (result.ok ? "考勤机数据库连接成功" : "连接失败"));
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        handleAdminApiError(err, "考勤机连接测试失败");
      } else {
        notification.error(cardErrorMessage(err, "考勤机连接测试失败"));
      }
    } finally {
      setCardDbTesting(false);
    }
  }

  async function handleAttendanceSync() {
    if (authUser?.role !== "admin" || !selectedAttendanceAccount) return;
    setAttendanceSyncing(true);
    setAttendanceResult(null);
    setHistoryLoading(false);
    setHistoryError("");
    setManagerProgress({ active: true, percent: 5, stage: "正在连接钉钉并准备同步..." });

    if (employeePollRef.current) clearInterval(employeePollRef.current);
    managerPollRef.current = setInterval(() => {
      if (typeof fetchSyncProgress === "function") {
        fetchSyncProgress(selectedAttendanceAccount, "manager")
          .then((prog) => {
            if (prog && prog.status !== "idle") {
              setManagerProgress({
                active: true,
                percent: prog.percent,
                stage: prog.stage || "正在同步管理人员考勤...",
              });
            }
          })
          .catch(() => {});
      }
    }, 300);

    const sequence = ++requestSequence.current;
    try {
      const result = await syncManagerAttendance(selectedAttendanceAccount);
      if (sequence !== requestSequence.current) return;
      setManagerProgress({ active: true, percent: 100, stage: "管理人员考勤同步完成" });
      setAttendanceResult(result);
      if (result.status === "success") notification.success("管理人员考勤同步成功");
      else if (result.status === "partial") notification.warning(result.message || "同步完成，但存在未匹配记录");
      else notification.error(result.message || "同步失败");
    } catch (err: any) {
      setManagerProgress((prev) => ({ ...prev, stage: "同步异常中断" }));
      handleAdminApiError(err, "管理人员考勤同步失败");
    } finally {
      if (managerPollRef.current) {
        clearInterval(managerPollRef.current);
        managerPollRef.current = null;
      }
      setAttendanceSyncing(false);
      setTimeout(() => {
        setManagerProgress((prev) => ({ ...prev, active: false }));
      }, 500);
    }
  }

  async function handleEmployeeSync() {
    if (authUser?.role !== "admin" || !selectedEmployeeAccount) return;
    setEmployeeSyncing(true);
    setEmployeeResult(null);
    setEmployeeHistoryLoading(false);
    setEmployeeHistoryError("");
    setEmployeeProgress({ active: true, percent: 5, stage: "正在连接考勤机数据库..." });

    if (employeePollRef.current) clearInterval(employeePollRef.current);
    employeePollRef.current = setInterval(() => {
      if (typeof fetchSyncProgress === "function") {
        fetchSyncProgress(selectedEmployeeAccount, "employee")
          .then((prog) => {
            if (prog && prog.status !== "idle") {
              setEmployeeProgress({
                active: true,
                percent: prog.percent,
                stage: prog.stage || "正在同步员工考勤...",
              });
            }
          })
          .catch(() => {});
      }
    }, 300);

    const sequence = ++employeeSequence.current;
    try {
      const result = await syncEmployeeAttendance(selectedEmployeeAccount);
      if (sequence !== employeeSequence.current) return;
      setEmployeeProgress({ active: true, percent: 100, stage: "员工考勤同步完成" });
      setEmployeeResult(result);
      if (result.status === "success") notification.success("员工考勤同步成功");
      else if (result.status === "partial") notification.warning(result.message || "同步完成，但存在未匹配记录");
      else notification.error(result.message || "同步失败");
    } catch (err: any) {
      setEmployeeProgress((prev) => ({ ...prev, stage: "同步异常中断" }));
      if (err?.status === 401 || err?.status === 403) {
        handleAdminApiError(err, "员工考勤同步失败");
      } else {
        notification.error(cardErrorMessage(err, "员工考勤同步失败"));
      }
    } finally {
      if (employeePollRef.current) {
        clearInterval(employeePollRef.current);
        employeePollRef.current = null;
      }
      setEmployeeSyncing(false);
      setTimeout(() => {
        setEmployeeProgress((prev) => ({ ...prev, active: false }));
      }, 500);
    }
  }

  useEffect(() => {
    if (authUser?.role !== "admin" || !selectedAttendanceAccount) return;
    const sequence = ++requestSequence.current;
    setAttendanceResult(null);
    setHistoryLoading(true);
    setHistoryError("");
    let active = true;
    fetchManagerAttendanceSyncHistory(selectedAttendanceAccount)
      .then((history) => { if (active && sequence === requestSequence.current) setAttendanceResult(history[0] ?? null); })
      .catch((err) => { if (active && sequence === requestSequence.current) { if (err?.status === 401 || err?.status === 403) { setAuthUser(null); setAuthChecked(true); setHistoryError(""); } else { setAttendanceResult(null); setHistoryError(err instanceof Error ? err.message : "同步历史加载失败"); } } })
      .finally(() => { if (active && sequence === requestSequence.current) setHistoryLoading(false); });
    return () => { active = false; };
  }, [authUser?.role, selectedAttendanceAccount]);

  useEffect(() => {
    if (authUser?.role !== "admin" || !selectedEmployeeAccount) return;
    const sequence = ++employeeSequence.current;
    setEmployeeResult(null);
    setEmployeeHistoryLoading(true);
    setEmployeeHistoryError("");
    let active = true;
    fetchEmployeeAttendanceSyncHistory(selectedEmployeeAccount)
      .then((history) => { if (active && sequence === employeeSequence.current) setEmployeeResult(history[0] ?? null); })
      .catch((err) => { if (active && sequence === employeeSequence.current) { if (err?.status === 401 || err?.status === 403) { setAuthUser(null); setAuthChecked(true); setEmployeeHistoryError(""); } else { setEmployeeResult(null); setEmployeeHistoryError(err instanceof Error ? err.message : "同步历史加载失败"); } } })
      .finally(() => { if (active && sequence === employeeSequence.current) setEmployeeHistoryLoading(false); });
    return () => { active = false; };
  }, [authUser?.role, selectedEmployeeAccount]);

  return (
    <main className="account-center-page">
      <section className="account-page-stack">
        <header className="settings-header-panel">
          <div className="settings-header-title-group">
            <h2 className="settings-header-title">更多设置</h2>
            <p className="settings-header-desc">
              配置员工考勤机（STCard_Enp 数据库）与管理人员钉钉数据源，管理连接凭据并执行账套同步。
            </p>
          </div>
        </header>

        {attendanceLoading && (
          <div className="settings-notice-bar settings-notice-bar--info" role="status">
            <span>⏳</span>
            <span>正在检查连接...</span>
          </div>
        )}
        {attendanceError && (
          <div className="settings-notice-bar settings-notice-bar--error" role="alert">
            <span>⚠️</span>
            <span>{attendanceError}</span>
          </div>
        )}

        {/* 员工考勤设置 */}
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <span className="settings-card-badge">员工考勤</span>
              <h3 className="settings-card-title">员工考勤数据源配置</h3>
              <p className="settings-card-desc">选择本地上传 Excel 或考勤机数据库同步。数据库密码保存后不再回显。</p>
            </div>
            {attendanceSettings && (
              <span
                className={`settings-status-badge ${
                  attendanceSettings.card_db_configured
                    ? "settings-status-badge--success"
                    : "settings-status-badge--warning"
                }`}
              >
                <span className="settings-status-dot" aria-hidden="true" />
                {attendanceSettings.card_db_configured ? "考勤机数据库已配置" : "考勤机数据库未配置"}
              </span>
            )}
          </div>

          {attendanceSettings && (
            <div className="settings-card-body">
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span className="admin-text-sm" style={{ color: "var(--ent-text-secondary)", fontWeight: 600 }}>
                  数据源：
                </span>
                <div className="settings-segmented-group" role="group" aria-label="员工考勤数据源选择">
                  {(["local", "card_db"] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      disabled={attendanceSaving}
                      onClick={() => handleEmployeeSourceChange(source)}
                      className={`settings-segmented-btn ${
                        attendanceSettings.employee_attendance_source === source ? "is-active" : ""
                      }`}
                    >
                      {source === "local" ? "本地上传" : "数据库同步"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 考勤机数据库连接参数表单 */}
              <div className="settings-form-panel">
                <div className="settings-form-panel-header">
                  <span className="settings-form-panel-title">
                    <span>🗄️</span> 考勤机数据库连接配置 (SQL Server)
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ent-text-secondary)" }}>
                    密码留空将保持已保存密码
                  </span>
                </div>

                <div className="settings-form-grid">
                  <div className="settings-form-field">
                    <label className="settings-form-label" htmlFor="card-db-host">考勤机地址</label>
                    <input
                      id="card-db-host"
                      className="settings-input"
                      value={cardDbForm.host}
                      onChange={(event) => setCardDbForm({ ...cardDbForm, host: event.target.value })}
                      placeholder="服务器地址"
                    />
                  </div>
                  <div className="settings-form-field">
                    <label className="settings-form-label" htmlFor="card-db-port">考勤机端口</label>
                    <input
                      id="card-db-port"
                      className="settings-input"
                      value={cardDbForm.port}
                      onChange={(event) => setCardDbForm({ ...cardDbForm, port: event.target.value })}
                      placeholder="1433"
                    />
                  </div>
                  <div className="settings-form-field">
                    <label className="settings-form-label" htmlFor="card-db-database">考勤机库名</label>
                    <input
                      id="card-db-database"
                      className="settings-input"
                      value={cardDbForm.database}
                      onChange={(event) => setCardDbForm({ ...cardDbForm, database: event.target.value })}
                      placeholder="STCard_Enp"
                    />
                  </div>
                  <div className="settings-form-field">
                    <label className="settings-form-label" htmlFor="card-db-user">考勤机账号</label>
                    <input
                      id="card-db-user"
                      className="settings-input"
                      value={cardDbForm.user}
                      onChange={(event) => setCardDbForm({ ...cardDbForm, user: event.target.value })}
                      placeholder="账号"
                    />
                  </div>
                  <div className="settings-form-field">
                    <label className="settings-form-label" htmlFor="card-db-password">考勤机密码</label>
                    <input
                      id="card-db-password"
                      type="password"
                      className="settings-input"
                      value={cardDbForm.password}
                      onChange={(event) => setCardDbForm({ ...cardDbForm, password: event.target.value })}
                      placeholder="留空则保留已保存密码"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={handleCardDbSave}
                    disabled={cardDbSaving}
                    className="account-action-button account-action-button--primary"
                  >
                    {cardDbSaving ? "保存中..." : "保存连接参数"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCardDbTest}
                    disabled={cardDbTesting}
                    className="account-action-button"
                  >
                    {cardDbTesting ? "测试中..." : "考勤机连接测试"}
                  </button>
                </div>
              </div>

              {/* 员工考勤账套同步控制 */}
              <div className="settings-sync-panel">
                {!authChecked && <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>正在检查管理员权限...</p>}
                {authChecked && authUser?.role !== "admin" && (
                  <div className="settings-notice-bar settings-notice-bar--warning">
                    <span>⚠️</span>
                    <span>员工考勤同步需要管理员登录，请先登录后再使用同步与账套控制。</span>
                  </div>
                )}
                {authUser?.role === "admin" && authChecked && attendanceAccounts.length === 0 && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>暂无员工考勤可用账套。</p>
                )}
                {authUser?.role === "admin" && (
                  <div className="settings-sync-row">
                    <label className="admin-text-sm" htmlFor="employee-attendance-account-set" style={{ fontWeight: 600 }}>
                      员工账套：
                    </label>
                    <select
                      id="employee-attendance-account-set"
                      className="settings-select"
                      value={selectedEmployeeAccount ?? ""}
                      onChange={(event) => setSelectedEmployeeAccount(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">请选择账套</option>
                      {attendanceAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name || account.month}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleEmployeeSync}
                      disabled={employeeSyncing || !selectedEmployeeAccount || attendanceSettings.employee_attendance_source !== "card_db"}
                      className="account-action-button account-action-button--primary"
                    >
                      {employeeSyncing ? "同步中..." : "同步员工考勤"}
                    </button>
                  </div>
                )}

                {employeeProgress.active && (
                  <div
                    className="settings-progress-card"
                    role="progressbar"
                    aria-valuenow={employeeProgress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="员工考勤同步进度"
                  >
                    <div className="settings-progress-header">
                      <div className="settings-progress-info">
                        <span className="settings-progress-spinner" aria-hidden="true" />
                        <span className="settings-progress-stage">{employeeProgress.stage}</span>
                      </div>
                      <span className="settings-progress-percent">{employeeProgress.percent}%</span>
                    </div>
                    <div className="settings-progress-track">
                      <div
                        className="settings-progress-fill"
                        style={{ width: `${Math.max(3, Math.min(100, employeeProgress.percent))}%` }}
                      />
                    </div>
                  </div>
                )}

                {authUser?.role === "admin" && employeeHistoryLoading && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>正在加载员工同步记录...</p>
                )}
                {authUser?.role === "admin" && employeeHistoryError && (
                  <div className="settings-notice-bar settings-notice-bar--error">
                    <span>⚠️</span>
                    <span>{employeeHistoryError}</span>
                  </div>
                )}
                {authUser?.role === "admin" && !employeeHistoryLoading && !employeeHistoryError && !employeeResult && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>暂无员工同步记录。</p>
                )}

                {employeeResult && (
                  <div style={{ marginTop: 6 }}>
                    <div
                      className={`settings-notice-bar ${
                        employeeResult.status === "failed"
                          ? "settings-notice-bar--error"
                          : employeeResult.unmatched_count
                            ? "settings-notice-bar--warning"
                            : "settings-notice-bar--success"
                      }`}
                      style={{ marginBottom: 12 }}
                    >
                      <span>{employeeResult.status === "failed" ? "❌" : employeeResult.unmatched_count ? "⚠️" : "✅"}</span>
                      <strong style={{ fontWeight: 600 }}>
                        {employeeResult.status === "partial"
                          ? `同步完成，但有 ${employeeResult.unmatched_count} 条未匹配记录`
                          : employeeResult.status === "success"
                            ? "同步成功"
                            : employeeResult.message}
                      </strong>
                    </div>

                    <div className="settings-metric-grid">
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">读取记录</span>
                        <span className="settings-metric-value settings-metric-value--primary">{employeeResult.read_count}</span>
                      </div>
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">成功导入</span>
                        <span className="settings-metric-value settings-metric-value--success">{employeeResult.imported_count}</span>
                      </div>
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">未匹配</span>
                        <span className={`settings-metric-value ${employeeResult.unmatched_count ? "settings-metric-value--warning" : ""}`}>
                          {employeeResult.unmatched_count}
                        </span>
                      </div>
                    </div>

                    <p style={{ fontSize: 13, color: "var(--ent-text-secondary)", margin: "0 0 12px" }}>
                      读取 {employeeResult.read_count} 条，导入 {employeeResult.imported_count} 条，未匹配 {employeeResult.unmatched_count} 条
                    </p>

                    {employeeResult.unmatched_count > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <QueryTable
                          headers={["工号", "姓名", "考勤日期"]}
                          rows={employeeResult.unmatched.map((item) => [
                            item.emp_no || "—",
                            item.name || "—",
                            item.record_date || "—",
                          ])}
                        />
                        {employeeResult.sync_run_id && (
                          <div>
                            <a
                              href={cardAttendanceUnmatchedCsvUrl(employeeResult.sync_run_id)}
                              download
                              aria-label="下载未匹配 CSV"
                              className="account-action-button"
                              style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                            >
                              <span aria-hidden="true">📥</span>
                              <span>下载未匹配 CSV</span>
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 管理人员考勤设置 */}
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <span className="settings-card-badge">管理人员考勤</span>
              <h3 className="settings-card-title">管理人员考勤数据源配置</h3>
              <p className="settings-card-desc">选择本地导入或钉钉同步。系统不会在页面显示任何钉钉密钥。</p>
            </div>
            {attendanceSettings && (
              <span
                className={`settings-status-badge ${
                  attendanceSettings.dingtalk_configured
                    ? "settings-status-badge--success"
                    : "settings-status-badge--warning"
                }`}
              >
                <span className="settings-status-dot" aria-hidden="true" />
                {attendanceSettings.dingtalk_configured ? "钉钉凭证已配置" : "未配置钉钉凭证"}
              </span>
            )}
          </div>

          {attendanceSettings && (
            <div className="settings-card-body">
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span className="admin-text-sm" style={{ color: "var(--ent-text-secondary)", fontWeight: 600 }}>
                  数据源：
                </span>
                <div className="settings-segmented-group" role="group" aria-label="管理人员考勤数据源选择">
                  {(["local", "dingtalk"] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      disabled={attendanceSaving}
                      onClick={() => handleAttendanceSourceChange(source)}
                      className={`settings-segmented-btn ${
                        attendanceSettings.manager_attendance_source === source ? "is-active" : ""
                      }`}
                    >
                      {source === "local" ? "本地导入" : "钉钉"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAttendanceConnectionTest}
                  disabled={attendanceLoading}
                  className="account-action-button"
                >
                  连接测试
                </button>
              </div>

              {/* 管理人员考勤账套同步控制 */}
              <div className="settings-sync-panel">
                {!authChecked && <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>正在检查管理员权限...</p>}
                {authChecked && authUser?.role !== "admin" && (
                  <div className="settings-notice-bar settings-notice-bar--warning">
                    <span>⚠️</span>
                    <span>管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。</span>
                  </div>
                )}

                {authUser?.role === "admin" && (
                  <div className="settings-sync-row">
                    <label className="admin-text-sm" htmlFor="attendance-account-set" style={{ fontWeight: 600 }}>
                      账套：
                    </label>
                    <select
                      id="attendance-account-set"
                      className="settings-select"
                      value={selectedAttendanceAccount ?? ""}
                      onChange={(event) => setSelectedAttendanceAccount(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">请选择账套</option>
                      {attendanceAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name || account.month}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAttendanceSync}
                      disabled={attendanceSyncing || !selectedAttendanceAccount || attendanceSettings.manager_attendance_source !== "dingtalk"}
                      className="account-action-button account-action-button--primary"
                    >
                      {attendanceSyncing ? "同步中..." : "同步管理人员考勤"}
                    </button>
                  </div>
                )}

                {managerProgress.active && (
                  <div
                    className="settings-progress-card"
                    role="progressbar"
                    aria-valuenow={managerProgress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="管理人员考勤同步进度"
                  >
                    <div className="settings-progress-header">
                      <div className="settings-progress-info">
                        <span className="settings-progress-spinner" aria-hidden="true" />
                        <span className="settings-progress-stage">{managerProgress.stage}</span>
                      </div>
                      <span className="settings-progress-percent">{managerProgress.percent}%</span>
                    </div>
                    <div className="settings-progress-track">
                      <div
                        className="settings-progress-fill"
                        style={{ width: `${Math.max(3, Math.min(100, managerProgress.percent))}%` }}
                      />
                    </div>
                  </div>
                )}

                {authUser?.role === "admin" && authChecked && attendanceAccounts.length === 0 && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>暂无可用账套。</p>
                )}
                {authUser?.role === "admin" && historyLoading && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>正在加载最近同步记录...</p>
                )}
                {authUser?.role === "admin" && historyError && (
                  <div className="settings-notice-bar settings-notice-bar--error">
                    <span>⚠️</span>
                    <span>{historyError}</span>
                  </div>
                )}
                {authUser?.role === "admin" && !historyLoading && !historyError && !attendanceResult && (
                  <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>暂无同步记录。</p>
                )}

                {attendanceResult && (
                  <div style={{ marginTop: 6 }}>
                    <div
                      className={`settings-notice-bar ${
                        attendanceResult.status === "failed"
                          ? "settings-notice-bar--error"
                          : attendanceResult.unmatched_count
                            ? "settings-notice-bar--warning"
                            : "settings-notice-bar--success"
                      }`}
                      style={{ marginBottom: 12 }}
                    >
                      <span>{attendanceResult.status === "failed" ? "❌" : attendanceResult.unmatched_count ? "⚠️" : "✅"}</span>
                      <strong style={{ fontWeight: 600 }}>
                        {attendanceResult.status === "partial"
                          ? `同步完成，但有 ${attendanceResult.unmatched_count} 条未匹配记录`
                          : attendanceResult.status === "success"
                            ? "同步成功"
                            : attendanceResult.message}
                      </strong>
                    </div>

                    <div className="settings-metric-grid">
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">读取记录</span>
                        <span className="settings-metric-value settings-metric-value--primary">{attendanceResult.read_count}</span>
                      </div>
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">成功导入</span>
                        <span className="settings-metric-value settings-metric-value--success">{attendanceResult.imported_count}</span>
                      </div>
                      <div className="settings-metric-card">
                        <span className="settings-metric-label">未匹配</span>
                        <span className={`settings-metric-value ${attendanceResult.unmatched_count ? "settings-metric-value--warning" : ""}`}>
                          {attendanceResult.unmatched_count}
                        </span>
                      </div>
                    </div>

                    <p style={{ fontSize: 13, color: "var(--ent-text-secondary)", margin: "0 0 12px" }}>
                      读取 {attendanceResult.read_count} 条，导入 {attendanceResult.imported_count} 条，未匹配 {attendanceResult.unmatched_count} 条
                    </p>

                    {attendanceResult.unmatched_count > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <QueryTable
                          headers={["钉钉工号", "姓名", "考勤日期"]}
                          rows={attendanceResult.unmatched.map((item) => [
                            item.emp_no || "—",
                            item.name || "—",
                            item.record_date || "—",
                          ])}
                        />
                        {attendanceResult.sync_run_id && (
                          <div>
                            <a
                              href={managerAttendanceUnmatchedCsvUrl(attendanceResult.sync_run_id)}
                              download
                              aria-label="下载未匹配 CSV"
                              className="account-action-button"
                              style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                            >
                              <span aria-hidden="true">📥</span>
                              <span>下载未匹配 CSV</span>
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

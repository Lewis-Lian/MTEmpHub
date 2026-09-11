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
    const sequence = ++requestSequence.current;
    try {
      const result = await syncManagerAttendance(selectedAttendanceAccount);
      if (sequence !== requestSequence.current) return;
      setAttendanceResult(result);
      if (result.status === "success") notification.success("管理人员考勤同步成功");
      else if (result.status === "partial") notification.warning(result.message || "同步完成，但存在未匹配记录");
      else notification.error(result.message || "同步失败");
    } catch (err: any) {
      handleAdminApiError(err, "管理人员考勤同步失败");
    } finally {
      setAttendanceSyncing(false);
    }
  }

  async function handleEmployeeSync() {
    if (authUser?.role !== "admin" || !selectedEmployeeAccount) return;
    setEmployeeSyncing(true);
    setEmployeeResult(null);
    setEmployeeHistoryLoading(false);
    setEmployeeHistoryError("");
    const sequence = ++employeeSequence.current;
    try {
      const result = await syncEmployeeAttendance(selectedEmployeeAccount);
      if (sequence !== employeeSequence.current) return;
      setEmployeeResult(result);
      if (result.status === "success") notification.success("员工考勤同步成功");
      else if (result.status === "partial") notification.warning(result.message || "同步完成，但存在未匹配记录");
      else notification.error(result.message || "同步失败");
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        handleAdminApiError(err, "员工考勤同步失败");
      } else {
        notification.error(cardErrorMessage(err, "员工考勤同步失败"));
      }
    } finally {
      setEmployeeSyncing(false);
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
        <div className="account-card-header master-list-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "none", background: "transparent", flexWrap: "wrap", gap: "12px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)", margin: 0 }}>更多设置</h2>
        </div>

        {attendanceLoading && <p style={{ padding: "0 4px" }}>正在检查连接...</p>}
        {attendanceError && <p style={{ padding: "0 4px", color: "#dc2626" }}>{attendanceError}</p>}

        <section className="legacy-surface admin-resource-panel">
          <div className="admin-resource-panel-head">
            <div>
              <p className="admin-resource-panel-kicker">员工考勤</p>
              <p className="admin-resource-panel-description">选择本地上传 Excel 或考勤机数据库同步。数据库密码保存后不再回显。</p>
            </div>
          </div>
          {attendanceSettings && <div style={{ padding: "0 24px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="admin-text-sm">数据源：</span>
              {(["local", "card_db"] as const).map((source) => (
                <button key={source} type="button" disabled={attendanceSaving} onClick={() => handleEmployeeSourceChange(source)} style={{ ...btnStyle, background: attendanceSettings.employee_attendance_source === source ? "#4f46e5" : "#fff", color: attendanceSettings.employee_attendance_source === source ? "#fff" : "#111827" }}>
                  {source === "local" ? "本地上传" : "数据库同步"}
                </button>
              ))}
              <span style={{ color: attendanceSettings.card_db_configured ? "#059669" : "#b45309", fontSize: 14 }}>{attendanceSettings.card_db_configured ? "考勤机数据库已配置" : "考勤机数据库未配置"}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16, maxWidth: 760 }}>
              <span>
                <label className="admin-text-sm" htmlFor="card-db-host" style={{ display: "block", marginBottom: 4 }}>考勤机地址</label>
                <input id="card-db-host" value={cardDbForm.host} onChange={(event) => setCardDbForm({ ...cardDbForm, host: event.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="服务器地址" />
              </span>
              <span>
                <label className="admin-text-sm" htmlFor="card-db-port" style={{ display: "block", marginBottom: 4 }}>考勤机端口</label>
                <input id="card-db-port" value={cardDbForm.port} onChange={(event) => setCardDbForm({ ...cardDbForm, port: event.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="1433" />
              </span>
              <span>
                <label className="admin-text-sm" htmlFor="card-db-database" style={{ display: "block", marginBottom: 4 }}>考勤机库名</label>
                <input id="card-db-database" value={cardDbForm.database} onChange={(event) => setCardDbForm({ ...cardDbForm, database: event.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="STCard_Enp" />
              </span>
              <span>
                <label className="admin-text-sm" htmlFor="card-db-user" style={{ display: "block", marginBottom: 4 }}>考勤机账号</label>
                <input id="card-db-user" value={cardDbForm.user} onChange={(event) => setCardDbForm({ ...cardDbForm, user: event.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="账号" />
              </span>
              <span>
                <label className="admin-text-sm" htmlFor="card-db-password" style={{ display: "block", marginBottom: 4 }}>考勤机密码</label>
                <input id="card-db-password" type="password" value={cardDbForm.password} onChange={(event) => setCardDbForm({ ...cardDbForm, password: event.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="留空则保留已保存密码" />
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={handleCardDbSave} disabled={cardDbSaving} style={btnStyle}>{cardDbSaving ? "保存中..." : "保存连接参数"}</button>
              <button type="button" onClick={handleCardDbTest} disabled={cardDbTesting} style={btnStyle}>{cardDbTesting ? "测试中..." : "考勤机连接测试"}</button>
            </div>

            {!authChecked && <p style={{ color: "#6b7280", fontSize: 14 }}>正在检查管理员权限...</p>}
            {authChecked && authUser?.role !== "admin" && <p style={{ color: "#b45309", fontSize: 14 }}>员工考勤同步需要管理员登录，请先登录后再使用同步与账套控制。</p>}
            {authUser?.role === "admin" && authChecked && attendanceAccounts.length === 0 && <p style={{ color: "#6b7280", fontSize: 14 }}>暂无员工考勤可用账套。</p>}
            {authUser?.role === "admin" && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <label className="admin-text-sm" htmlFor="employee-attendance-account-set">员工账套：</label>
              <select id="employee-attendance-account-set" value={selectedEmployeeAccount ?? ""} onChange={(event) => setSelectedEmployeeAccount(event.target.value ? Number(event.target.value) : null)} style={inputStyle}>
                <option value="">请选择账套</option>
                {attendanceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.month}</option>)}
              </select>
              <button type="button" onClick={handleEmployeeSync} disabled={employeeSyncing || !selectedEmployeeAccount || attendanceSettings.employee_attendance_source !== "card_db"} style={{ ...btnStyle, background: employeeSyncing ? "#9ca3af" : "#2563eb", color: "#fff" }}>{employeeSyncing ? "同步中..." : "同步员工考勤"}</button>
            </div>}
            {authUser?.role === "admin" && employeeHistoryLoading && <p style={{ color: "#6b7280", fontSize: 14 }}>正在加载员工同步记录...</p>}
            {authUser?.role === "admin" && employeeHistoryError && <p style={{ color: "#dc2626", fontSize: 14 }}>{employeeHistoryError}</p>}
            {authUser?.role === "admin" && !employeeHistoryLoading && !employeeHistoryError && !employeeResult && <p style={{ color: "#6b7280", fontSize: 14 }}>暂无员工同步记录。</p>}
            {employeeResult && <div style={{ marginTop: 16 }}>
              <p style={{ margin: "0 0 8px", color: employeeResult.status === "failed" ? "#dc2626" : employeeResult.unmatched_count ? "#b45309" : "#059669" }}>
                {employeeResult.status === "partial" ? `同步完成，但有 ${employeeResult.unmatched_count} 条未匹配记录` : employeeResult.status === "success" ? "同步成功" : employeeResult.message}
              </p>
              <p style={{ fontSize: 14, color: "#4b5563" }}>读取 {employeeResult.read_count} 条，导入 {employeeResult.imported_count} 条，未匹配 {employeeResult.unmatched_count} 条</p>
              {employeeResult.unmatched_count > 0 && <>
                <QueryTable headers={["工号", "姓名", "考勤日期"]} rows={employeeResult.unmatched.map((item) => [item.emp_no || "—", item.name || "—", item.record_date || "—"])} />
                {employeeResult.sync_run_id && <a href={cardAttendanceUnmatchedCsvUrl(employeeResult.sync_run_id)} download style={{ display: "inline-block", marginTop: 12, color: "#2563eb" }}>下载未匹配 CSV</a>}
              </>}
            </div>}
          </div>}
        </section>

        <section className="legacy-surface admin-resource-panel">
          <div className="admin-resource-panel-head">
            <div>
              <p className="admin-resource-panel-kicker">管理人员考勤</p>
              <p className="admin-resource-panel-description">选择本地导入或钉钉同步。系统不会在页面显示任何钉钉密钥。</p>
            </div>
          </div>
          {attendanceSettings && <div style={{ padding: "0 24px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="admin-text-sm">数据源：</span>
              {(["local", "dingtalk"] as const).map((source) => (
                <button key={source} type="button" disabled={attendanceSaving} onClick={() => handleAttendanceSourceChange(source)} style={{ ...btnStyle, background: attendanceSettings.manager_attendance_source === source ? "#4f46e5" : "#fff", color: attendanceSettings.manager_attendance_source === source ? "#fff" : "#111827" }}>
                  {source === "local" ? "本地导入" : "钉钉"}
                </button>
              ))}
              <button type="button" onClick={handleAttendanceConnectionTest} disabled={attendanceLoading} style={btnStyle}>连接测试</button>
              <span style={{ color: attendanceSettings.dingtalk_configured ? "#059669" : "#b45309", fontSize: 14 }}>{attendanceSettings.dingtalk_configured ? "钉钉凭证已配置" : "未配置钉钉凭证"}</span>
            </div>
            {!authChecked && <p style={{ color: "#6b7280", fontSize: 14 }}>正在检查管理员权限...</p>}
            {authChecked && authUser?.role !== "admin" && <p style={{ color: "#b45309", fontSize: 14 }}>管理人员同步需要管理员登录，请先登录后再使用同步与账套控制。</p>}
            {authUser?.role === "admin" && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <label className="admin-text-sm" htmlFor="attendance-account-set">账套：</label>
              <select id="attendance-account-set" value={selectedAttendanceAccount ?? ""} onChange={(event) => setSelectedAttendanceAccount(event.target.value ? Number(event.target.value) : null)} style={inputStyle}>
                <option value="">请选择账套</option>
                {attendanceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.month}</option>)}
              </select>
              <button type="button" onClick={handleAttendanceSync} disabled={attendanceSyncing || !selectedAttendanceAccount || attendanceSettings.manager_attendance_source !== "dingtalk"} style={{ ...btnStyle, background: attendanceSyncing ? "#9ca3af" : "#2563eb", color: "#fff" }}>{attendanceSyncing ? "同步中..." : "同步管理人员考勤"}</button>
            </div>}
            {authUser?.role === "admin" && authChecked && attendanceAccounts.length === 0 && <p style={{ color: "#6b7280", fontSize: 14 }}>暂无可用账套。</p>}
            {authUser?.role === "admin" && historyLoading && <p style={{ color: "#6b7280", fontSize: 14 }}>正在加载最近同步记录...</p>}
            {authUser?.role === "admin" && historyError && <p style={{ color: "#dc2626", fontSize: 14 }}>{historyError}</p>}
            {authUser?.role === "admin" && !historyLoading && !historyError && !attendanceResult && <p style={{ color: "#6b7280", fontSize: 14 }}>暂无同步记录。</p>}
            {attendanceResult && <div style={{ marginTop: 16 }}>
              <p style={{ margin: "0 0 8px", color: attendanceResult.status === "failed" ? "#dc2626" : attendanceResult.unmatched_count ? "#b45309" : "#059669" }}>
                {attendanceResult.status === "partial" ? `同步完成，但有 ${attendanceResult.unmatched_count} 条未匹配记录` : attendanceResult.status === "success" ? "同步成功" : attendanceResult.message}
              </p>
              <p style={{ fontSize: 14, color: "#4b5563" }}>读取 {attendanceResult.read_count} 条，导入 {attendanceResult.imported_count} 条，未匹配 {attendanceResult.unmatched_count} 条</p>
              {attendanceResult.unmatched_count > 0 && <>
                <QueryTable headers={["钉钉工号", "姓名", "考勤日期"]} rows={attendanceResult.unmatched.map((item) => [item.emp_no || "—", item.name || "—", item.record_date || "—"])} />
                {attendanceResult.sync_run_id && <a href={managerAttendanceUnmatchedCsvUrl(attendanceResult.sync_run_id)} download style={{ display: "inline-block", marginTop: 12, color: "#2563eb" }}>下载未匹配 CSV</a>}
              </>}
            </div>}
          </div>}
        </section>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 20px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
  background: "#fff",
};

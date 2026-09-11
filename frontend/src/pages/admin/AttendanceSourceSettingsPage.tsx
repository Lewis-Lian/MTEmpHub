import { useEffect, useRef, useState } from "react";

import {
  fetchAttendanceSettings,
  saveAttendanceSettings,
  testAttendanceConnection,
  fetchAccountSets,
  syncManagerAttendance,
  fetchManagerAttendanceSyncHistory,
  managerAttendanceUnmatchedCsvUrl,
  type AdminAttendanceSettings,
  type ManagerAttendanceSyncResult,
} from "../../api/admin";
import { fetchMe, type AuthUser } from "../../api/auth";
import QueryTable from "../../components/query/QueryTable";
import { useNotification } from "../../components/feedback/Notification";

export default function AttendanceSourceSettingsPage() {
  const notification = useNotification();
  const [attendanceSettings, setAttendanceSettings] = useState<AdminAttendanceSettings | null>(null);
  const [attendanceAccounts, setAttendanceAccounts] = useState<Array<{ id: number; month: string; name: string; is_active?: boolean }>>([]);
  const [selectedAttendanceAccount, setSelectedAttendanceAccount] = useState<number | null>(null);
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
            setSelectedAttendanceAccount(accounts.find((account) => account.is_active)?.id ?? accounts[0]?.id ?? null);
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

  function handleAdminApiError(err: any, defaultMsg: string) {
    if (err?.status === 401 || err?.status === 403) {
      setAuthUser(null);
      setAuthChecked(true);
      notification.warning("管理员登录已过期，请重新登录");
    } else {
      notification.error(err instanceof Error ? err.message : defaultMsg);
    }
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

  return (
    <main className="account-center-page">
      <section className="account-page-stack">
        <div className="account-card-header master-list-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "none", background: "transparent", flexWrap: "wrap", gap: "12px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)", margin: 0 }}>更多设置</h2>
        </div>

        <section className="legacy-surface admin-resource-panel">
          <div className="admin-resource-panel-head">
            <div>
              <p className="admin-resource-panel-kicker">管理人员考勤</p>
              <p className="admin-resource-panel-description">选择本地导入或钉钉同步。系统不会在页面显示任何钉钉密钥。</p>
            </div>
          </div>
          {attendanceLoading && <p style={{ padding: "0 24px" }}>正在检查连接...</p>}
          {attendanceError && <p style={{ padding: "0 24px", color: "#dc2626" }}>{attendanceError}</p>}
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

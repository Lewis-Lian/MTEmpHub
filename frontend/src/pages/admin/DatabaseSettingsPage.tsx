import { useEffect, useRef, useState } from "react";

import {
  getDatabaseSettings,
  saveDatabaseSettings,
  testDatabaseConnection,
  migrateDatabase,
  migrateToSqliteDatabase,
  switchToSqlite,
  switchToMysql,
  type DatabaseSettings,
  fetchAttendanceSettings,
  testAttendanceConnection,
  saveAttendanceSettings,
  fetchAccountSets,
  syncManagerAttendance,
  fetchManagerAttendanceSyncHistory,
  managerAttendanceUnmatchedCsvUrl,
  type AdminAttendanceSettings,
  type ManagerAttendanceSyncResult,
} from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import QueryTable from "../../components/query/QueryTable";
import { useNotification } from "../../components/feedback/Notification";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
import { Link } from "react-router-dom";
import { fetchMe, type AuthUser } from "../../api/auth";

export default function DatabaseSettingsPage() {
  const notification = useNotification();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [setupPassword, setSetupPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState("");

  // MySQL 表单
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // 操作状态
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResults, setMigrationResults] = useState<Array<{ table: string; rows: number; status: string }> | null>(null);
  const [attendanceSettings, setAttendanceSettings] = useState<AdminAttendanceSettings | null>(null);
  const [attendanceAccounts, setAttendanceAccounts] = useState<Array<{ id: number; month: string; name: string; is_active?: boolean }>>([]);
  const [selectedAttendanceAccount, setSelectedAttendanceAccount] = useState<number | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceSyncing, setAttendanceSyncing] = useState(false);
  const [attendanceResult, setAttendanceResult] = useState<ManagerAttendanceSyncResult | null>(null);
  const [attendanceError, setAttendanceError] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const requestSequence = useRef(0);

  async function handleUnlock() {
    if (!setupPassword) {
      setUnlockError("请输入密码");
      return;
    }
    setLoading(true);
    setUnlockError("");
    try {
      const data = await getDatabaseSettings(setupPassword);
      setSettings(data);
      const cfg = data.mysql_config || {};
      if (cfg.host) setHost(cfg.host);
      if (cfg.port) setPort(String(cfg.port));
      if (cfg.username) setUsername(cfg.username);
      if (cfg.password) setPassword(cfg.password);
      if (cfg.database) setDatabase(cfg.database);
      
      setUnlocked(true);
      setLoadError("");
      setAttendanceLoading(true);
      try {
        const attendance = await fetchAttendanceSettings(setupPassword);
        setAttendanceSettings(attendance);
        try {
          const user = await fetchMe();
          setAuthUser(user);
          if (user.role === "admin") {
            try {
              const accounts = await fetchAccountSets();
              setAttendanceAccounts(accounts);
              setSelectedAttendanceAccount(accounts.find((account) => account.is_active)?.id ?? accounts[0]?.id ?? null);
            } catch (err: any) {
              if (err?.status === 401 || err?.status === 403) {
                setAuthUser(null);
                setAuthChecked(true);
              }
              setAttendanceError(err instanceof Error ? err.message : "账套加载失败");
            }
          }
        } catch {
          setAuthUser(null);
        } finally { setAuthChecked(true); }
      } catch (err: any) {
        setAttendanceError(err instanceof Error ? err.message : "考勤设置加载失败");
      } finally {
        setAttendanceLoading(false);
      }
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setUnlockError(err.message || "密码错误");
        setUnlocked(false);
      } else {
        setLoadError(err instanceof Error ? err.message : "加载失败");
        setUnlocked(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // 部署密码仅保留在会话内存中，刷新页面需重新输入
    setLoading(false);
  }, []);

  function handleApiError(err: any, defaultMsg: string) {
    if (err.status === 401 || err.status === 403) {
      setUnlocked(false);
      notification.error("访问凭证已过期，请重新解锁");
    } else {
      notification.error(err instanceof Error ? err.message : defaultMsg);
    }
  }

  async function handleAttendanceSourceChange(source: AdminAttendanceSettings["manager_attendance_source"]) {
    if (!attendanceSettings || source === attendanceSettings.manager_attendance_source) return;
    setAttendanceSaving(true);
    try {
      const result = await saveAttendanceSettings(source, setupPassword);
      setAttendanceSettings(result);
      notification.success("考勤数据源已保存");
    } catch (err: any) {
      handleApiError(err, "保存考勤数据源失败");
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function handleAttendanceConnectionTest() {
    setAttendanceLoading(true);
    try {
      const result = await testAttendanceConnection(setupPassword);
      notification[result.ok ? "success" : "error"](result.message || (result.ok ? "钉钉连接成功" : "连接失败"));
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        handleApiError(err, "连接测试失败");
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

  function handleAdminApiError(err: any, defaultMsg: string) {
    if (err?.status === 401 || err?.status === 403) {
      setAuthUser(null);
      setAuthChecked(true);
      notification.warning("管理员登录已过期，请重新登录后使用同步功能");
    } else {
      notification.error(err instanceof Error ? err.message : defaultMsg);
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

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testDatabaseConnection({ host, port: Number(port), username, password, database }, setupPassword);
      if (res.ok) {
        notification.success("连接测试成功");
      } else {
        notification.error(res.message || "连接失败");
      }
    } catch (err: any) {
      handleApiError(err, "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveDatabaseSettings({ host, port: Number(port), username, password, database }, setupPassword);
      notification.success(res.message || "暂存成功");
    } catch (err: any) {
      handleApiError(err, "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleMigrate() {
    const isConfirmed = await confirm({
      message: "确定要将 SQLite 数据迁移到 MySQL 吗？请确保 MySQL 数据库为空且暂存配置已保存。",
      type: "danger",
    });
    if (!isConfirmed) return;
    setMigrating(true);
    setMigrationResults(null);
    try {
      const res = await migrateDatabase(setupPassword);
      if (res.ok && res.results) {
        setMigrationResults(res.results);
        notification.success(`迁移完成，共 ${res.results.filter((r: any) => r.status === "ok").length} 张表`);
      } else {
        notification.error(res.message || "迁移失败");
      }
    } catch (err: any) {
      handleApiError(err, "迁移失败");
    } finally {
      setMigrating(false);
    }
  }

  async function handleMigrateToSqlite() {
    const isConfirmed = await confirm({
      message: "确定要将 MySQL 数据全量迁移回 SQLite 吗？这将覆盖现有的 SQLite 数据库。请确保 MySQL 来源配置有效。",
      type: "danger",
    });
    if (!isConfirmed) return;
    setMigrating(true);
    setMigrationResults(null);
    try {
      const res = await migrateToSqliteDatabase(setupPassword);
      if (res.ok && res.results) {
        setMigrationResults(res.results);
        notification.success(`反向迁移完成，共 ${res.results.filter((r: any) => r.status === "ok").length} 张表`);
      } else {
        notification.error(res.message || "反向迁移失败");
      }
    } catch (err: any) {
      handleApiError(err, "反向迁移失败");
    } finally {
      setMigrating(false);
    }
  }

  if (loading) return <LoadingState message="正在加载数据库设置..." variant="database-unlock" />;

  if (!unlocked) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ backgroundColor: "#fff", padding: "40px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", width: "100%", maxWidth: 400 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 20 }}>安全解锁</h2>
          <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>此系统部署页面已被保护。<br/>请输入 <b>SETUP_PASSWORD</b> 进行访问。</p>
          <input
            type="password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="请输入向导密码"
            style={{ ...inputStyle, width: "100%", marginBottom: 16, boxSizing: "border-box" }}
          />
          {unlockError && <p style={{ color: "#dc2626", fontSize: 14, marginBottom: 16, marginTop: -8 }}>{unlockError}</p>}
          <button onClick={handleUnlock} style={{ ...btnStyle, background: "#4f46e5", color: "#fff", width: "100%" }}>
            解锁并进入
          </button>
          
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <Link to="/login" style={{ fontSize: 14, color: "#4f46e5", textDecoration: "none" }}>&larr; 返回普通登录页</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) return <ErrorState title="加载失败" description={loadError} />;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f3f4f6", padding: "40px 20px" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", position: "relative" }}>
        <button 
          onClick={() => {
            setSetupPassword("");
            setUnlocked(false);
          }}
          style={{ 
            position: "absolute", 
            top: 0, 
            right: 0, 
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6b7280", 
            fontWeight: 500,
            fontSize: 14,
            padding: 0
          }}
        >
          重新锁定 🔒
        </button>
        <section className="legacy-page-section">
          <header className="legacy-page-header">
            <div className="legacy-page-heading">
              <h2 className="legacy-page-title" style={{ marginTop: 0 }}>系统部署向导：数据库设置</h2>
              <p className="legacy-page-description" style={{ color: "#059669", fontWeight: "bold" }}>页面已成功解锁。配置与迁移期间，请勿泄露访问凭证。</p>
            </div>
          </header>

      {/* 区域一：当前连接状态 */}
      <section className="legacy-surface admin-resource-panel" style={{ marginBottom: 24 }}>
        <div className="admin-resource-panel-head">
          <div>
            <p className="admin-resource-panel-kicker">当前连接</p>
            <p className="admin-resource-panel-title">当前数据库连接信息</p>
          </div>
        </div>
        {settings?.current && (
          <QueryTable
            headers={["配置项", "当前值", "说明"]}
            rows={settings.current.map((row) => [row.item, row.value, row.description])}
          />
        )}
      </section>

      {/* 区域二：MySQL 连接配置 */}
      <section className="legacy-surface admin-resource-panel" style={{ marginBottom: 24 }}>
        <div className="admin-resource-panel-head">
          <div>
            <p className="admin-resource-panel-kicker">MySQL 配置</p>
            <p className="admin-resource-panel-title">MySQL 连接信息</p>
            <p className="admin-resource-panel-description">填写 MySQL 连接信息后点击【暂存配置】。</p>
          </div>
        </div>
        <div style={{ padding: "16px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="admin-stack-sm">
            <span className="admin-text-sm">主机地址</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" style={inputStyle} />
          </label>
          <label className="admin-stack-sm">
            <span className="admin-text-sm">端口</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3306" style={inputStyle} />
          </label>
          <label className="admin-stack-sm">
            <span className="admin-text-sm">用户名</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" style={inputStyle} />
          </label>
          <label className="admin-stack-sm">
            <span className="admin-text-sm">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="数据库密码"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
            <span className="admin-text-sm">数据库名</span>
            <input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="attendance_db"
              style={inputStyle}
            />
          </label>
        </div>
        <div style={{ padding: "0 24px 16px", display: "flex", gap: 8 }}>
          <button onClick={handleTest} disabled={testing} style={btnStyle}>
            {testing ? "测试中..." : "测试连接"}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: "#f59e0b", color: "#fff" }}>
            {saving ? "暂存中..." : "暂存配置"}
          </button>
          <button
            onClick={async () => {
              if (!(await confirm({
                message: "确定要切换到刚才暂存的 MySQL 配置吗？重启应用后生效。",
                type: "warning",
              }))) return;
              try {
                const res = await switchToMysql(setupPassword);
                notification.success(res.message || "已切换到 MySQL");
              } catch (err: any) {
                handleApiError(err, "切换失败");
              }
            }}
            style={{ ...btnStyle, background: "#2563eb", color: "#fff" }}
          >
            切换到 MySQL
          </button>
          <button
            onClick={async () => {
              if (!(await confirm({
                message: "确定要切回 SQLite 吗？系统连接将重置。重启应用后生效。",
                type: "warning",
              }))) return;
              try {
                const res = await switchToSqlite(setupPassword);
                notification.success(res.message || "已切换回 SQLite");
              } catch (err: any) {
                handleApiError(err, "切换失败");
              }
            }}
            style={btnStyle}
          >
            切回 SQLite
          </button>
        </div>
      </section>

      {/* 区域三：考勤数据源 */}
      <section className="legacy-surface admin-resource-panel" style={{ marginBottom: 24 }}>
        <div className="admin-resource-panel-head">
          <div>
            <p className="admin-resource-panel-kicker">管理人员考勤</p>
            <p className="admin-resource-panel-title">考勤数据源</p>
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

      {/* 区域四：数据迁移 */}
      <section className="legacy-surface admin-resource-panel">
        <div className="admin-resource-panel-head">
          <div>
            <p className="admin-resource-panel-kicker">数据迁移</p>
            <p className="admin-resource-panel-title">SQLite ↔ MySQL 数据迁移</p>
            <p className="admin-resource-panel-description">
              在 SQLite 和 MySQL 之间进行数据迁移。请确保已暂存 MySQL 配置。反向迁移会覆盖当前 SQLite。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleMigrate}
              disabled={migrating}
              style={{
                ...btnStyle,
                background: migrating ? "#9ca3af" : "#dc2626",
                color: "#fff",
              }}
            >
              {migrating ? "迁移中..." : "导出至 MySQL"}
            </button>
            <button
              onClick={handleMigrateToSqlite}
              disabled={migrating}
              style={{
                ...btnStyle,
                background: migrating ? "#9ca3af" : "#f59e0b",
                color: "#fff",
              }}
            >
              {migrating ? "迁移中..." : "从 MySQL 导回"}
            </button>
          </div>
        </div>
        {migrationResults && (
          <div style={{ padding: "0 24px 16px" }}>
            <QueryTable
              headers={["表名", "迁移行数", "状态"]}
              rows={migrationResults.map((r) => [
                r.table,
                r.rows,
                r.status === "ok" ? "✅ 成功" : r.status === "skipped" ? "跳过（无数据）" : r.status,
              ])}
            />
          </div>
        )}
      </section>
      </section>
      </div>
    </div>
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

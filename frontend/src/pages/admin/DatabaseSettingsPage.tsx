import { useEffect, useState } from "react";

import {
  fetchDatabaseSettings,
  saveDatabaseSettings,
  testDatabaseConnection,
  migrateDatabase,
  switchToSqlite,
  type DatabaseSettings,
} from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import QueryTable from "../../components/query/QueryTable";
import { useNotification } from "../../components/feedback/Notification";

export default function DatabaseSettingsPage() {
  const notification = useNotification();
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

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

  useEffect(() => {
    let mounted = true;
    fetchDatabaseSettings()
      .then((data) => {
        if (!mounted) return;
        setSettings(data);
        const cfg = data.mysql_config || {};
        if (cfg.host) setHost(cfg.host);
        if (cfg.port) setPort(String(cfg.port));
        if (cfg.username) setUsername(cfg.username);
        if (cfg.password) setPassword(cfg.password);
        if (cfg.database) setDatabase(cfg.database);
      })
      .catch((err) => {
        if (mounted) setLoadError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testDatabaseConnection({ host, port: Number(port), username, password, database });
      if (res.ok) {
        notification.success("连接测试成功");
      } else {
        notification.error(res.message || "连接失败");
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveDatabaseSettings({ host, port: Number(port), username, password, database });
      notification.success(res.message || "保存成功");
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleMigrate() {
    if (!confirm("确定要将 SQLite 数据迁移到 MySQL 吗？请确保 MySQL 数据库为空且连接配置已保存。")) return;
    setMigrating(true);
    setMigrationResults(null);
    try {
      const res = await migrateDatabase();
      if (res.ok && res.results) {
        setMigrationResults(res.results);
        notification.success(`迁移完成，共 ${res.results.filter((r) => r.status === "ok").length} 张表`);
      } else {
        notification.error(res.message || "迁移失败");
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "迁移失败");
    } finally {
      setMigrating(false);
    }
  }

  if (loading) return <LoadingState message="正在加载数据库设置..." />;
  if (loadError) return <ErrorState title="加载失败" description={loadError} />;

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">后台管理</p>
          <h2 className="legacy-page-title">数据库设置</h2>
          <p className="legacy-page-description">管理数据库连接配置，支持 SQLite 和 MySQL 切换。</p>
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
            <p className="admin-resource-panel-description">填写 MySQL 连接信息后保存，重启应用后生效。</p>
          </div>
        </div>
        <div style={{ padding: "16px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>主机地址</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>端口</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3306" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>用户名</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="数据库密码"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>数据库名</span>
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
          <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: "#2563eb", color: "#fff" }}>
            {saving ? "保存中..." : "保存配置"}
          </button>
          <button
            onClick={async () => {
              if (!confirm("确定要切换回 SQLite 吗？重启应用后生效。")) return;
              try {
                const res = await switchToSqlite();
                notification.success(res.message || "已切换");
              } catch (err) {
                notification.error(err instanceof Error ? err.message : "切换失败");
              }
            }}
            style={btnStyle}
          >
            切回 SQLite
          </button>
        </div>
      </section>

      {/* 区域三：数据迁移 */}
      <section className="legacy-surface admin-resource-panel">
        <div className="admin-resource-panel-head">
          <div>
            <p className="admin-resource-panel-kicker">数据迁移</p>
            <p className="admin-resource-panel-title">SQLite → MySQL 数据迁移</p>
            <p className="admin-resource-panel-description">
              将当前 SQLite 数据库中的所有数据迁移到 MySQL。请确保已保存 MySQL 配置且目标数据库为空。
            </p>
          </div>
          <button
            onClick={handleMigrate}
            disabled={migrating}
            style={{
              ...btnStyle,
              background: migrating ? "#9ca3af" : "#dc2626",
              color: "#fff",
            }}
          >
            {migrating ? "迁移中..." : "开始迁移"}
          </button>
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

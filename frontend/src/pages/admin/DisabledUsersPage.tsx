import { useEffect, useState } from "react";

import { fetchDisabledUsers, unlockDisabledUser } from "../../api/admin";
import type { AdminDisabledUser } from "../../types/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";

export default function DisabledUsersPage() {
  const [users, setUsers] = useState<AdminDisabledUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [resultError, setResultError] = useState("");
  const [workingUserId, setWorkingUserId] = useState<number | null>(null);

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    setIsLoading(true);
    setLoadError("");
    try {
      setUsers(await fetchDisabledUsers());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "禁用用户页面加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUnlock(user: AdminDisabledUser) {
    setWorkingUserId(user.id);
    setResultMessage("");
    setResultError("");
    try {
      await unlockDisabledUser(user.id);
      setResultMessage(`已解锁账号：${user.username}`);
      await loadUsers();
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "解锁失败");
    } finally {
      setWorkingUserId(null);
    }
  }

  if (isLoading) {
    return <LoadingState message="正在准备禁用用户页面..." />;
  }

  if (loadError) {
    return <ErrorState title="禁用用户页面加载失败" description={loadError} />;
  }

  return (
    <main className="account-center-page">
      <section className="legacy-page-section">
        <header className="legacy-page-header">
          <div className="legacy-page-heading">
            <p className="legacy-page-kicker">系统设置</p>
            <h2 className="legacy-page-title">禁用用户</h2>
            <p className="legacy-page-description">查看当前被限制登录的账号，并由管理员手动解锁。</p>
          </div>
        </header>

        <section className="account-card table-wrap-tight">
          <div className="account-card-header">
            <span>禁用登录账号列表</span>
            <button className="account-action-button" onClick={() => void loadUsers()} type="button">
              刷新
            </button>
          </div>
          <div className="account-card-body">
            {resultMessage ? <div className="account-result-message">{resultMessage}</div> : null}
            {resultError ? <div className="legacy-inline-error">{resultError}</div> : null}
            <div className="legacy-table-shell">
              <table className="legacy-table">
                <thead>
                  <tr>
                    <th className="legacy-table-head-cell">用户名</th>
                    <th className="legacy-table-head-cell">姓名</th>
                    <th className="legacy-table-head-cell">工号</th>
                    <th className="legacy-table-head-cell">累计错误次数</th>
                    <th className="legacy-table-head-cell">禁用状态</th>
                    <th className="legacy-table-head-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length ? (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td className="legacy-table-body-cell">{user.username}</td>
                        <td className="legacy-table-body-cell">{user.profile_name || "-"}</td>
                        <td className="legacy-table-body-cell">{user.profile_emp_no || "-"}</td>
                        <td className="legacy-table-body-cell">{user.login_failed_attempts}</td>
                        <td className="legacy-table-body-cell">{formatLoginStatus(user)}</td>
                        <td className="legacy-table-body-cell">
                          <button
                            className="account-action-button account-action-button--primary"
                            disabled={workingUserId === user.id}
                            onClick={() => void handleUnlock(user)}
                            type="button"
                          >
                            {workingUserId === user.id ? "解锁中..." : "解锁"}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="legacy-table-empty" colSpan={6}>
                        当前没有被禁用登录的用户
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function formatLoginStatus(user: AdminDisabledUser): string {
  if (user.login_disabled_until_admin_unlock) {
    return "已永久禁用，需管理员解锁";
  }
  if (user.login_locked_until) {
    return `临时禁用至 ${formatTime(user.login_locked_until)}`;
  }
  return "正常";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

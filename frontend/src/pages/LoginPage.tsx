import type { FormEvent } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { login, type AuthUser } from "../api/auth";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo = typeof location.state?.from === "string" ? location.state.from : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const user = await login({ username, password });
      onLogin(user);
      navigate(redirectTo ?? defaultLandingPath(user), { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "登录失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-surface">
          <section className="login-brand-panel" aria-label="系统品牌">
            <div className="login-brand-panel-inner">
              <div className="login-brand">
                <span className="login-brand-mark" aria-hidden="true">
                  <span className="login-brand-mark-top"></span>
                  <span className="login-brand-mark-bars">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </span>
                <span className="login-brand-text">企业考勤处理中心</span>
              </div>
              <div className="login-brand-copy">
                <h1 className="login-brand-title">统一处理考勤、账套与权限数据</h1>
                <p className="login-brand-subtitle">
                  面向内部业务场景的考勤数据工作台，支持查询、修正、下载和账号权限控制。
                </p>
              </div>
              <ul className="login-brand-points" aria-label="系统能力">
                <li>员工、部门与管理人员考勤统一查询</li>
                <li>账套导入、考勤修正与结果下载协同处理</li>
                <li>登录后按角色进入对应功能页面</li>
              </ul>
            </div>
          </section>
          <section className="login-panel-wrap">
            <div className="login-card">
              <div className="login-panel-top">
                <p className="login-panel-kicker">账号登录</p>
                <h2 className="login-panel-title">登录考勤系统</h2>
                <p className="login-panel-subtitle">请输入用户名和密码进入系统</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <label className="login-field">
                  <span className="login-field-label">用户名</span>
                  <input
                    autoComplete="username"
                    className="login-input"
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    value={username}
                  />
                </label>
                <label className="login-field">
                  <span className="login-field-label">密码</span>
                  <input
                    autoComplete="current-password"
                    className="login-input"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </label>
                {error ? <p className="login-error">{error}</p> : null}
                <button className="login-submit-btn" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "登录中..." : "登录"}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function defaultLandingPath(user: AuthUser): string {
  return user.role === "admin" ? "/admin/dashboard" : "/employee/home";
}

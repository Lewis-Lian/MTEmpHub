import type { FormEvent } from "react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { login, type AuthUser } from "../api/auth";
import AnimatedCharacters from "../components/AnimatedCharacters";
import { triggerNotification } from "../components/feedback/Notification";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {

  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo = typeof location.state?.from === "string" ? location.state.from : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const user = await login({
        username,
        password,
        remember_me: rememberMe,
      });
      onLogin(user);
      navigate(redirectTo ?? defaultLandingPath(user), { replace: true });
    } catch (caughtError) {
      const errMsg = caughtError instanceof ApiError ? caughtError.message : "登录失败，请稍后重试";
      setError(errMsg);
      triggerNotification(errMsg, "error");
    } finally {
      setIsSubmitting(false);
    }
  }


  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-surface">
          <section className="login-brand-panel" aria-label="考勤系统品牌">
            <div className="login-brand-panel-inner">
              <div className="login-brand login-brand--career">
                <Link className="login-brand-home" to="/login">
                  <span aria-hidden="true" className="login-brand-logo login-brand-logo--system">
                    MT
                  </span>
                  <span className="login-brand-text">考勤系统</span>
                </Link>
              </div>
              <div className="login-brand-stage" aria-hidden="true">
                <AnimatedCharacters
                  isTyping={isTyping}
                  passwordLength={password.length}
                  showPassword={showPassword}
                />
              </div>
              <div className="login-brand-links">
                <a className="login-brand-link" href="/privacy-policy">
                  Privacy Policy
                </a>
                <a className="login-brand-link" href="/terms">
                  Terms of Service
                </a>
              </div>
            </div>
          </section>
          <section className="login-panel-wrap">
            <div className="login-card">
              <div className="login-mobile-brand">
                <span aria-hidden="true" className="login-career-logo login-career-logo--system">
                  MT
                </span>
                <span>考勤系统</span>
              </div>
              <div className="login-panel-top">
                <h2 className="login-panel-title">欢迎回来！</h2>
                <p className="login-panel-subtitle">请输入您的登录信息</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <label className="login-field">
                  <span className="login-field-label">账号</span>
                  <input
                    autoComplete="off"
                    className="login-input"
                    onChange={(event) => setUsername(event.target.value)}
                    onBlur={() => setIsTyping(false)}
                    onFocus={() => setIsTyping(true)}
                    placeholder="请输入账号"
                    required
                    type="text"
                    value={username}
                  />
                </label>
                <label className="login-field">
                  <span className="login-field-label">密码</span>
                  <span className="login-password-control">
                    <input
                      autoComplete="current-password"
                      className="login-input login-input--password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      className="login-password-toggle"
                      onClick={() => setShowPassword((current) => !current)}
                      type="button"
                    >
                      {showPassword ? (
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
                          <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a16.2 16.2 0 0 1-2.1 2.9" />
                          <path d="M6.6 6.6C3.9 8.3 2.5 12 2.5 12s3.5 7 9.5 7a9 9 0 0 0 4.8-1.4" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                          <circle cx="12" cy="12" r="2.5" />
                        </svg>
                      )}
                    </button>
                  </span>
                </label>
                <div className="login-form-meta">
                  <label className="login-remember">
                    <input
                      aria-label="30 天内记住我"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      type="checkbox"
                    />
                    <span>30 天内记住我</span>
                  </label>
                  <Link className="login-link" to="/change-password">
                    忘记密码？
                  </Link>
                </div>
                {error ? <p className="login-error">{error}</p> : null}
                <button
                  className="login-submit-btn login-submit-btn--interactive"
                  disabled={isSubmitting}
                  type="submit"
                >
                  <span>{isSubmitting ? "登录中..." : "登录"}</span>
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function defaultLandingPath(_user: AuthUser): string {
  return "/employee/home";
}

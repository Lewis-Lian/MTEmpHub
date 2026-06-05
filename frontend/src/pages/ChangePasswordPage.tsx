import type { FormEvent } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { changePassword } from "../api/auth";
import { ApiError } from "../api/client";
import AnimatedCharacters from "../components/AnimatedCharacters";
import { useNotification } from "../components/feedback/Notification";

export default function ChangePasswordPage() {
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const notification = useNotification();
  const passwordLength = currentPassword.length + newPassword.length + confirmPassword.length;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    try {
      await changePassword({
        username,
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      const successMsg = "密码修改成功，请使用新密码登录。";
      setSuccess(successMsg);
      notification.success(successMsg);
    } catch (caughtError) {
      const errMsg = caughtError instanceof ApiError ? caughtError.message : "修改失败，请稍后重试";
      setError(errMsg);
      notification.error(errMsg);
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
                  passwordLength={passwordLength}
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
                <h2 className="login-panel-title">修改密码</h2>
                <p className="login-panel-subtitle">请使用原密码完成身份验证</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <label className="login-field">
                  <span className="login-field-label">用户名</span>
                  <input
                    autoComplete="username"
                    className="login-input"
                    onChange={(event) => setUsername(event.target.value)}
                    onBlur={() => setIsTyping(false)}
                    onFocus={() => setIsTyping(true)}
                    required
                    value={username}
                  />
                </label>
                <label className="login-field">
                  <span className="login-field-label">原密码</span>
                  <span className="login-password-control">
                    <input
                      aria-label="原密码"
                      autoComplete="current-password"
                      className="login-input login-input--password"
                      onBlur={() => setIsTyping(false)}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      onFocus={() => setIsTyping(true)}
                      required
                      type={showPassword ? "text" : "password"}
                      value={currentPassword}
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
                <label className="login-field">
                  <span className="login-field-label">新密码</span>
                  <span className="login-password-control">
                    <input
                      aria-label="新密码"
                      autoComplete="new-password"
                      className="login-input login-input--password"
                      onBlur={() => setIsTyping(false)}
                      onChange={(event) => setNewPassword(event.target.value)}
                      onFocus={() => setIsTyping(true)}
                      required
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
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
                <label className="login-field">
                  <span className="login-field-label">确认新密码</span>
                  <span className="login-password-control">
                    <input
                      aria-label="确认新密码"
                      autoComplete="new-password"
                      className="login-input login-input--password"
                      onBlur={() => setIsTyping(false)}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      onFocus={() => setIsTyping(true)}
                      required
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
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
                  <Link className="login-link" to="/login">
                    返回登录
                  </Link>
                </div>
                {error ? <p className="login-error">{error}</p> : null}
                {success ? <p className="login-success">{success}</p> : null}
                <button className="login-submit-btn" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "修改中..." : "确认修改"}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

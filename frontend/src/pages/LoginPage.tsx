import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { login, type AuthUser } from "../api/auth";
import AnimatedCharacters from "../components/AnimatedCharacters";
import Logo from "../components/common/Logo";
import { triggerNotification } from "../components/feedback/Notification";
import SliderCaptcha from "../components/auth/SliderCaptcha";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

type LoginFieldErrors = { username?: string; password?: string };

export default function LoginPage({ onLogin }: LoginPageProps) {

  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  // 滑块 token 失效（如 5 分钟过期后提交收到 403）时递增该 key，强制重挂载滑块重新验证。
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const redirectTo = typeof location.state?.from === "string" ? location.state.from : null;

  function clearFieldError(field: keyof LoginFieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 字段校验：账号 trim 后判空（与后端 strip 行为一致），密码仅判空。
    const trimmedUsername = username.trim();
    const nextFieldErrors: LoginFieldErrors = {};
    if (!trimmedUsername) nextFieldErrors.username = "请输入账号";
    if (!password) nextFieldErrors.password = "请输入密码";
    if (nextFieldErrors.username || nextFieldErrors.password) {
      setFieldErrors(nextFieldErrors);
      setError("");
      (nextFieldErrors.username ? usernameInputRef.current : passwordInputRef.current)?.focus();
      return;
    }

    if (!captchaToken) {
      setError("请先完成滑块验证");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const user = await login({
        username: trimmedUsername,
        password,
        remember_me: rememberMe,
        captcha_token: captchaToken,
      });
      onLogin(user);
      navigate(redirectTo ?? defaultLandingPath(user), { replace: true });
    } catch (caughtError) {
      const errMsg = caughtError instanceof ApiError ? caughtError.message : "登录失败，请稍后重试";
      setError(errMsg);
      triggerNotification(errMsg, "error");
      // 403 = 滑块验证缺失/已过期：自动重置滑块，让用户重新完成验证而不是反复报错。
      if (caughtError instanceof ApiError && caughtError.status === 403) {
        setCaptchaToken("");
        setCaptchaResetKey((key) => key + 1);
      }
    } finally {
      setIsSubmitting(false);
    }
  }


  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-surface">
          <section className="login-brand-panel" aria-label="MTEmpHub 品牌">
            <div className="login-brand-panel-inner">
              <div className="login-brand login-brand--career">
                <Link className="login-brand-home" to="/login">
                  <Logo size={36} variant="full" textColor="#ffffff" />
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
                <Logo size={32} variant="full" textColor="var(--ent-text, #183153)" />
              </div>
              <div className="login-panel-top">
                <h2 className="login-panel-title">欢迎回来！</h2>
                <p className="login-panel-subtitle">请输入您的登录信息</p>
              </div>
              <form className="login-form" noValidate onSubmit={handleSubmit}>
                <div className="login-field">
                  <label className="login-field-label" htmlFor="login-username">
                    账号
                  </label>
                  <input
                    aria-describedby={fieldErrors.username ? "login-username-error" : undefined}
                    aria-invalid={fieldErrors.username ? true : undefined}
                    autoComplete="username"
                    className={`login-input${fieldErrors.username ? " login-input--invalid" : ""}`}
                    id="login-username"
                    onChange={(event) => {
                      setUsername(event.target.value);
                      clearFieldError("username");
                    }}
                    onBlur={() => setIsTyping(false)}
                    onFocus={() => setIsTyping(true)}
                    placeholder="请输入账号"
                    ref={usernameInputRef}
                    type="text"
                    value={username}
                  />
                  {fieldErrors.username ? (
                    <span className="login-field-error" id="login-username-error">
                      {fieldErrors.username}
                    </span>
                  ) : null}
                </div>
                <div className="login-field">
                  <label className="login-field-label" htmlFor="login-password">
                    密码
                  </label>
                  <span className="login-password-control">
                    <input
                      aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                      aria-invalid={fieldErrors.password ? true : undefined}
                      autoComplete="current-password"
                      className={`login-input login-input--password${fieldErrors.password ? " login-input--invalid" : ""}`}
                      id="login-password"
                      onChange={(event) => {
                        setPassword(event.target.value);
                        clearFieldError("password");
                      }}
                      placeholder="••••••••"
                      ref={passwordInputRef}
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
                  {fieldErrors.password ? (
                    <span className="login-field-error" id="login-password-error">
                      {fieldErrors.password}
                    </span>
                  ) : null}
                </div>
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
                    修改密码
                  </Link>
                </div>
                <div className="login-field" style={{ marginBottom: "16px" }}>
                  <SliderCaptcha
                    key={captchaResetKey}
                    onReset={() => setCaptchaToken("")}
                    onVerified={setCaptchaToken}
                  />
                </div>
                {error ? (
                  <p className="login-error" role="alert">
                    {error}
                  </p>
                ) : null}
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

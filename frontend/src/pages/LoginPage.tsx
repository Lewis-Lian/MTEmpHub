import type { CSSProperties, FormEvent } from "react";
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

  const redirectTo = typeof location.state?.from === "string" ? location.state.from : "/employee/dashboard";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const user = await login({ username, password });
      onLogin(user);
      navigate(redirectTo, { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "登录失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <p style={eyebrowStyle}>Mt Employee Attendance</p>
          <h1 style={headingStyle}>登录考勤系统</h1>
          <p style={descriptionStyle}>前后端分离改造的最小前端入口，当前仅提供登录与受保护路由骨架。</p>
        </div>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={labelStyle}>
            用户名
            <input
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              style={inputStyle}
              value={username}
            />
          </label>
          <label style={labelStyle}>
            密码
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              style={inputStyle}
              type="password"
              value={password}
            />
          </label>
          {error ? <p style={errorStyle}>{error}</p> : null}
          <button disabled={isSubmitting} style={submitStyle} type="submit">
            {isSubmitting ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background:
    "radial-gradient(circle at top, rgba(244, 201, 93, 0.45), transparent 35%), linear-gradient(180deg, #f4efe4 0%, #dce8de 100%)",
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
};

const cardStyle: CSSProperties = {
  width: "min(420px, 100%)",
  padding: "32px",
  borderRadius: "24px",
  background: "rgba(255, 255, 255, 0.88)",
  boxShadow: "0 24px 60px rgba(24, 49, 83, 0.12)",
  display: "grid",
  gap: "24px",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#5c6f68",
};

const headingStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: "32px",
  color: "#183153",
};

const descriptionStyle: CSSProperties = {
  margin: "12px 0 0",
  color: "#4b5d67",
  lineHeight: 1.6,
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const labelStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  color: "#183153",
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  borderRadius: "12px",
  border: "1px solid #c4d0c5",
  padding: "12px 14px",
  fontSize: "16px",
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b42318",
};

const submitStyle: CSSProperties = {
  border: "none",
  borderRadius: "12px",
  padding: "14px 16px",
  background: "#183153",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "16px",
  fontWeight: 600,
};

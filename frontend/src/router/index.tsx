import type { CSSProperties } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../api/auth";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import AppShell from "../layouts/AppShell";
import LoginPage from "../pages/LoginPage";

interface AppRouterProps {
  isLoading: boolean;
  onLogin: (user: AuthUser) => void;
  onLogout: (user: AuthUser | null) => void;
  user: AuthUser | null;
}

export default function AppRouter({ isLoading, onLogin, onLogout, user }: AppRouterProps) {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={user ? <Navigate to="/employee/dashboard" replace /> : <LoginPage onLogin={onLogin} />}
          path="/login"
        />
        <Route element={<ProtectedRoute isLoading={isLoading} user={user} />}>
          <Route element={user ? <AppShell onLogout={onLogout} user={user} /> : null}>
            <Route element={<DashboardPlaceholder user={user} />} path="/employee/dashboard" />
          </Route>
        </Route>
        <Route element={<Navigate to={user ? "/employee/dashboard" : "/login"} replace />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

function DashboardPlaceholder({ user }: { user: AuthUser | null }) {
  return (
    <section style={pageStyle}>
      <p style={tagStyle}>受保护页面</p>
      <h2 style={titleStyle}>员工首页占位页</h2>
      <p style={bodyStyle}>
        当前登录用户：
        <strong>{user?.username ?? "-"}</strong>
        。Task 4 只负责前端工程与统一路由骨架，这里暂时保留最小占位内容，等待后续页面迁移任务接入。
      </p>
    </section>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: "720px",
  padding: "32px",
  borderRadius: "24px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};

const tagStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontSize: "12px",
};

const titleStyle: CSSProperties = {
  margin: "12px 0 16px",
  fontSize: "32px",
  color: "#183153",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  color: "#4b5d67",
  lineHeight: 1.8,
};

import type { CSSProperties } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { AuthUser } from "../../api/auth";

interface ProtectedRouteProps {
  isLoading: boolean;
  user: AuthUser | null;
}

export default function ProtectedRoute({ isLoading, user }: ProtectedRouteProps) {
  const location = useLocation();

  if (isLoading) {
    return <div style={loadingStyle}>正在检查登录状态...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

const loadingStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
};

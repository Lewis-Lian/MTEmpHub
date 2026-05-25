import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { AuthUser } from "../../api/auth";

interface ProtectedRouteProps {
  isLoading: boolean;
  user: AuthUser | null;
}

export default function ProtectedRoute({ isLoading, user }: ProtectedRouteProps) {
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="legacy-page-center">
        <div className="legacy-panel">正在检查登录状态...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

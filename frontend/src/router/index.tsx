import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../api/auth";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import AppShell from "../layouts/AppShell";
import LoginPage from "../pages/LoginPage";
import { protectedRoutes } from "./protectedRoutes";

interface AppRouterProps {
  isLoading: boolean;
  onLogin: (user: AuthUser) => void;
  onLogout: (user: AuthUser | null) => void;
  user: AuthUser | null;
}

export default function AppRouter({ isLoading, onLogin, onLogout, user }: AppRouterProps) {
  const landingPath = user ? defaultLandingPath(user) : "/login";

  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={user ? <Navigate to={landingPath} replace /> : <LoginPage onLogin={onLogin} />}
          path="/login"
        />
        <Route element={<ProtectedRoute isLoading={isLoading} user={user} />}>
          <Route element={user ? <AppShell onLogout={onLogout} user={user} /> : null}>
            {protectedRoutes.map((route) => (
              <Route element={route.element} key={route.path} path={route.path} />
            ))}
          </Route>
        </Route>
        <Route element={<Navigate to={landingPath} replace />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

function defaultLandingPath(user: AuthUser): string {
  return user.role === "admin" ? "/admin/dashboard" : "/employee/home";
}

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../api/auth";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import AppShell from "../layouts/AppShell";
import AccountsPage from "../pages/admin/AccountsPage";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import DepartmentsPage from "../pages/admin/DepartmentsPage";
import EmployeeAttendanceOverridesPage from "../pages/admin/EmployeeAttendanceOverridesPage";
import EmployeesPage from "../pages/admin/EmployeesPage";
import ManagerAnnualLeaveAdminPage from "../pages/admin/ManagerAnnualLeaveAdminPage";
import ManagerAttendanceOverridesPage from "../pages/admin/ManagerAttendanceOverridesPage";
import ManagerOvertimeAdminPage from "../pages/admin/ManagerOvertimeAdminPage";
import ShiftsPage from "../pages/admin/ShiftsPage";
import AbnormalQueryPage from "../pages/query/AbnormalQueryPage";
import DepartmentHoursPage from "../pages/query/DepartmentHoursPage";
import EmployeeDashboardPage from "../pages/query/EmployeeDashboardPage";
import ManagerAnnualLeavePage from "../pages/query/ManagerAnnualLeavePage";
import ManagerDepartmentHoursPage from "../pages/query/ManagerDepartmentHoursPage";
import ManagerOvertimePage from "../pages/query/ManagerOvertimePage";
import ManagerQueryPage from "../pages/query/ManagerQueryPage";
import PunchRecordsPage from "../pages/query/PunchRecordsPage";
import QueryHomePage from "../pages/query/QueryHomePage";
import SummaryDownloadPage from "../pages/query/SummaryDownloadPage";
import LoginPage from "../pages/LoginPage";

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
            <Route element={<QueryHomePage />} path="/employee/home" />
            <Route element={<EmployeeDashboardPage />} path="/employee/dashboard" />
            <Route element={<AbnormalQueryPage />} path="/employee/abnormal-query" />
            <Route element={<PunchRecordsPage />} path="/employee/punch-records" />
            <Route element={<DepartmentHoursPage />} path="/employee/department-hours-query" />
            <Route element={<ManagerQueryPage />} path="/employee/manager-query" />
            <Route element={<ManagerOvertimePage />} path="/employee/manager-overtime-query" />
            <Route element={<ManagerAnnualLeavePage />} path="/employee/manager-annual-leave-query" />
            <Route element={<ManagerDepartmentHoursPage />} path="/employee/manager-department-hours-query" />
            <Route element={<SummaryDownloadPage />} path="/employee/summary-download" />
            <Route element={<AdminDashboardPage />} path="/admin/dashboard" />
            <Route element={<AccountsPage />} path="/admin/accounts" />
            <Route element={<EmployeesPage />} path="/admin/employees/manage" />
            <Route element={<DepartmentsPage />} path="/admin/departments/manage" />
            <Route element={<ShiftsPage />} path="/admin/shifts/manage" />
            <Route element={<EmployeeAttendanceOverridesPage />} path="/admin/employee-attendance-overrides" />
            <Route element={<ManagerAttendanceOverridesPage />} path="/admin/manager-attendance-overrides" />
            <Route element={<ManagerOvertimeAdminPage />} path="/admin/manager-overtime" />
            <Route element={<ManagerAnnualLeaveAdminPage />} path="/admin/manager-annual-leave" />
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

import type { ReactElement } from "react";
import AccountsPage from "../pages/admin/AccountsPage";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import DepartmentsPage from "../pages/admin/DepartmentsPage";
import DisabledUsersPage from "../pages/admin/DisabledUsersPage";
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

export interface ProtectedRouteConfig {
  element: ReactElement;
  path: string;
}

export const protectedRoutes: ProtectedRouteConfig[] = [
  { element: <QueryHomePage />, path: "/employee/home" },
  { element: <EmployeeDashboardPage />, path: "/employee/dashboard" },
  { element: <AbnormalQueryPage />, path: "/employee/abnormal-query" },
  { element: <PunchRecordsPage />, path: "/employee/punch-records" },
  { element: <DepartmentHoursPage />, path: "/employee/department-hours-query" },
  { element: <ManagerQueryPage />, path: "/employee/manager-query" },
  { element: <ManagerOvertimePage />, path: "/employee/manager-overtime-query" },
  { element: <ManagerAnnualLeavePage />, path: "/employee/manager-annual-leave-query" },
  { element: <ManagerDepartmentHoursPage />, path: "/employee/manager-department-hours-query" },
  { element: <SummaryDownloadPage />, path: "/employee/summary-download" },
  { element: <AdminDashboardPage />, path: "/admin/dashboard" },
  { element: <AccountsPage />, path: "/admin/accounts" },
  { element: <DisabledUsersPage />, path: "/admin/disabled-users" },
  { element: <EmployeesPage />, path: "/admin/employees/manage" },
  { element: <DepartmentsPage />, path: "/admin/departments/manage" },
  { element: <ShiftsPage />, path: "/admin/shifts/manage" },
  { element: <EmployeeAttendanceOverridesPage />, path: "/admin/employee-attendance-overrides" },
  { element: <ManagerAttendanceOverridesPage />, path: "/admin/manager-attendance-overrides" },
  { element: <ManagerOvertimeAdminPage />, path: "/admin/manager-overtime" },
  { element: <ManagerAnnualLeaveAdminPage />, path: "/admin/manager-annual-leave" },
];

export function findProtectedRoute(pathname: string): ProtectedRouteConfig | undefined {
  return protectedRoutes.find((route) => route.path === pathname);
}

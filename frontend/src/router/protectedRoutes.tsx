import { lazy, Suspense } from "react";
import type { ComponentType, LazyExoticComponent, ReactElement } from "react";

const AccountsPage = lazy(() => import("../pages/admin/AccountsPage"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage"));
const DepartmentsPage = lazy(() => import("../pages/admin/DepartmentsPage"));
const DisabledUsersPage = lazy(() => import("../pages/admin/DisabledUsersPage"));
const EmployeeAttendanceOverridesPage = lazy(() => import("../pages/admin/EmployeeAttendanceOverridesPage"));
const EmployeesPage = lazy(() => import("../pages/admin/EmployeesPage"));
const LateOffsetPage = lazy(() => import("../pages/admin/LateOffsetPage"));
const ManagerAnnualLeaveAdminPage = lazy(() => import("../pages/admin/ManagerAnnualLeaveAdminPage"));
const ManagerAttendanceOverridesPage = lazy(() => import("../pages/admin/ManagerAttendanceOverridesPage"));
const ManagerOvertimeAdminPage = lazy(() => import("../pages/admin/ManagerOvertimeAdminPage"));
const ShiftsPage = lazy(() => import("../pages/admin/ShiftsPage"));
const AbnormalQueryPage = lazy(() => import("../pages/query/AbnormalQueryPage"));
const AttendanceCalendarPage = lazy(() => import("../pages/query/AttendanceCalendarPage"));
const DepartmentHoursPage = lazy(() => import("../pages/query/DepartmentHoursPage"));
const EmployeeDashboardPage = lazy(() => import("../pages/query/EmployeeDashboardPage"));
const ManagerAnnualLeavePage = lazy(() => import("../pages/query/ManagerAnnualLeavePage"));
const ManagerDepartmentHoursPage = lazy(() => import("../pages/query/ManagerDepartmentHoursPage"));
const ManagerOvertimePage = lazy(() => import("../pages/query/ManagerOvertimePage"));
const ManagerQueryPage = lazy(() => import("../pages/query/ManagerQueryPage"));
const PunchRecordsPage = lazy(() => import("../pages/query/PunchRecordsPage"));
const QueryHomePage = lazy(() => import("../pages/query/QueryHomePage"));
const SummaryDownloadPage = lazy(() => import("../pages/query/SummaryDownloadPage"));

export interface ProtectedRouteConfig {
  element: ReactElement;
  path: string;
}

function lazyPage(Page: LazyExoticComponent<ComponentType>): ReactElement {
  return (
    <Suspense fallback={<div className="page-loading">加载中…</div>}>
      <Page />
    </Suspense>
  );
}

export const protectedRoutes: ProtectedRouteConfig[] = [
  { element: lazyPage(QueryHomePage), path: "/employee/home" },
  { element: lazyPage(EmployeeDashboardPage), path: "/employee/dashboard" },
  { element: lazyPage(AbnormalQueryPage), path: "/employee/abnormal-query" },
  { element: lazyPage(PunchRecordsPage), path: "/employee/punch-records" },
  { element: lazyPage(DepartmentHoursPage), path: "/employee/department-hours-query" },
  { element: lazyPage(ManagerQueryPage), path: "/employee/manager-query" },
  { element: lazyPage(ManagerOvertimePage), path: "/employee/manager-overtime-query" },
  { element: lazyPage(ManagerAnnualLeavePage), path: "/employee/manager-annual-leave-query" },
  { element: lazyPage(ManagerDepartmentHoursPage), path: "/employee/manager-department-hours-query" },
  { element: lazyPage(SummaryDownloadPage), path: "/employee/summary-download" },
  { element: lazyPage(AttendanceCalendarPage), path: "/employee/attendance-calendar" },
  { element: lazyPage(AdminDashboardPage), path: "/admin/dashboard" },
  { element: lazyPage(AccountsPage), path: "/admin/accounts" },
  { element: lazyPage(DisabledUsersPage), path: "/admin/disabled-users" },
  { element: lazyPage(EmployeesPage), path: "/admin/employees/manage" },
  { element: lazyPage(DepartmentsPage), path: "/admin/departments/manage" },
  { element: lazyPage(ShiftsPage), path: "/admin/shifts/manage" },
  { element: lazyPage(EmployeeAttendanceOverridesPage), path: "/admin/employee-attendance-overrides" },
  { element: lazyPage(ManagerAttendanceOverridesPage), path: "/admin/manager-attendance-overrides" },
  { element: lazyPage(LateOffsetPage), path: "/admin/late-offset" },
  { element: lazyPage(ManagerOvertimeAdminPage), path: "/admin/manager-overtime" },
  { element: lazyPage(ManagerAnnualLeaveAdminPage), path: "/admin/manager-annual-leave" },
];

export function findProtectedRoute(pathname: string): ProtectedRouteConfig | undefined {
  return protectedRoutes.find((route) => route.path === pathname);
}

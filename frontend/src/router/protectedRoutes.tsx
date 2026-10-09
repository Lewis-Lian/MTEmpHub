import { lazy, Suspense } from "react";
import type { ComponentType, LazyExoticComponent, ReactElement } from "react";
import { matchPath, Navigate, useLocation } from "react-router-dom";

const AccountsPage = lazy(() => import("../pages/admin/AccountsPage"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage"));
const AdminMessagesPage = lazy(() => import("../pages/admin/AdminMessagesPage"));
const MoreSettingsPage = lazy(() => import("../pages/admin/MoreSettingsPage"));
const AttendanceSourceSettingsPage = lazy(() => import("../pages/admin/AttendanceSourceSettingsPage"));
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
const DepartmentHoursPage = lazy(() => import("../pages/query/DepartmentHoursPage"));
const EmployeeDashboardPage = lazy(() => import("../pages/query/EmployeeDashboardPage"));
const ManagerAnnualLeavePage = lazy(() => import("../pages/query/ManagerAnnualLeavePage"));
const ManagerDepartmentHoursPage = lazy(() => import("../pages/query/ManagerDepartmentHoursPage"));
const ManagerOvertimePage = lazy(() => import("../pages/query/ManagerOvertimePage"));
const ManagerQueryPage = lazy(() => import("../pages/query/ManagerQueryPage"));
const IndividualAttendancePage = lazy(() => import("../pages/query/IndividualAttendancePage"));
const MessageDetailPage = lazy(() => import("../pages/query/MessageDetailPage"));
const PunchRecordsPage = lazy(() => import("../pages/query/PunchRecordsPage"));
const QueryHomePage = lazy(() => import("../pages/query/QueryHomePage"));
const SummaryDownloadPage = lazy(() => import("../pages/query/SummaryDownloadPage"));
const MealTicketPage = lazy(() => import("../pages/MealTicketPage"));
const MealTicketQueryPage = lazy(() => import("../pages/query/MealTicketQueryPage"));
const MealLedgerPage = lazy(() => import("../pages/MealLedgerPage"));
const MealDownloadPage = lazy(() => import("../pages/MealDownloadPage"));

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

function LegacyDownloadRedirect() {
  const location = useLocation();
  // Tabs keep inactive pages mounted; only the active legacy URL may redirect.
  return location.pathname === "/employee/summary-download"
    ? <Navigate to={`/downloads/attendance${location.search}${location.hash}`} replace /> : null;
}

export const protectedRoutes: ProtectedRouteConfig[] = [
  { element: lazyPage(MealTicketQueryPage), path: "/employee/meal-ticket-query" },
  { element: lazyPage(SummaryDownloadPage), path: "/downloads/attendance" },
  { element: lazyPage(MealDownloadPage), path: "/downloads/meal-tickets" },
  ...(["department", "external", "annual", "clearance"] as const).map(kind => ({
    element: <Suspense fallback={<div className="page-loading">加载中…</div>}><MealLedgerPage kind={kind} /></Suspense>,
    path: `/meal-tickets/${kind === "department" ? "departments" : kind}`,
  })),
  { element: <Suspense fallback={<div className="page-loading">加载中…</div>}><MealTicketPage view="calculation" /></Suspense>, path: "/meal-tickets/calculation" },
  { element: <Suspense fallback={<div className="page-loading">加载中…</div>}><MealTicketPage view="payments" /></Suspense>, path: "/meal-tickets/payments" },
  { element: <Suspense fallback={<div className="page-loading">加载中…</div>}><MealTicketPage view="history" /></Suspense>, path: "/meal-tickets/history" },
  { element: lazyPage(QueryHomePage), path: "/employee/home" },
  { element: lazyPage(MessageDetailPage), path: "/employee/messages/:id" },
  { element: lazyPage(EmployeeDashboardPage), path: "/employee/dashboard" },
  { element: lazyPage(AbnormalQueryPage), path: "/employee/abnormal-query" },
  { element: lazyPage(PunchRecordsPage), path: "/employee/punch-records" },
  { element: lazyPage(DepartmentHoursPage), path: "/employee/department-hours-query" },
  { element: lazyPage(ManagerQueryPage), path: "/employee/manager-query" },
  { element: lazyPage(IndividualAttendancePage), path: "/employee/individual-attendance" },
  { element: lazyPage(ManagerOvertimePage), path: "/employee/manager-overtime-query" },
  { element: lazyPage(ManagerAnnualLeavePage), path: "/employee/manager-annual-leave-query" },
  { element: lazyPage(ManagerDepartmentHoursPage), path: "/employee/manager-department-hours-query" },
  { element: <LegacyDownloadRedirect />, path: "/employee/summary-download" },
  { element: lazyPage(AdminDashboardPage), path: "/admin/dashboard" },
  { element: lazyPage(AccountsPage), path: "/admin/accounts" },
  { element: lazyPage(AdminMessagesPage), path: "/admin/messages" },
  { element: lazyPage(MoreSettingsPage), path: "/admin/more-settings" },
  { element: lazyPage(AttendanceSourceSettingsPage), path: "/admin/attendance-source" },
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
  return protectedRoutes.find((route) => {
    if (route.path === pathname) return true;
    return matchPath({ path: route.path, end: true }, pathname) !== null;
  });
}

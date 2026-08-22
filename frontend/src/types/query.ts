export interface QueryNavigationEntry {
  key: string;
  label: string;
  href: string;
  description?: string;
}

export interface QueryNavigationModule {
  slug: string;
  label: string;
  short_label: string;
  description?: string;
  home_href: string;
  entries: QueryNavigationEntry[];
}

export interface QueryEmployee {
  id: number;
  emp_no: string;
  name: string;
  dept_id: number | null;
  dept_name: string;
  is_manager: boolean;
}

export interface AccountSet {
  id: number;
  month: string;
  name: string;
  is_active: boolean;
  is_locked?: boolean;
  factory_rest_days?: number;
  factory_rest_requires_detail?: boolean;
  legacy_factory_rest_days?: number;
  monthly_benefit_days?: number;
}

export interface DepartmentOption {
  id: number;
  dept_no: string;
  dept_name: string;
  parent_id: number | null;
}

export interface QueryBootstrap {
  employees: QueryEmployee[];
  account_sets: AccountSet[];
  departments: DepartmentOption[];
}

export interface HeaderRowsResponse {
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

export interface FactoryRestEntry {
  date: string;
  period: string;
}

export interface HomeSummaryResponse {
  has_data: boolean;
  empty_state: string;
  month: string;
  account_set_name: string;
  support_message?: string;
  manager?: {
    emp_no: string;
    name: string;
    dept_name: string;
  };
  summary?: Record<string, number | string>;
  factory_rest_entries?: FactoryRestEntry[];
}

export interface AttendanceCalendarEmployee {
  id: number;
  emp_no: string;
  name: string;
  dept_name: string;
}

export interface AttendanceCalendarDay {
  date: string;
  check_in_times: string[];
  check_out_times: string[];
  punch_count: number;
  actual_hours: number;
  late_minutes: number;
  early_leave_minutes: number;
  is_half_day: boolean;
  exception_reason: string;
}

export interface AttendanceCalendarOvertime {
  date: string;
  is_evening: boolean;
  is_weekend: boolean;
  is_holiday: boolean;
  hours: number;
}

export interface AttendanceCalendarLeave {
  date: string;
  leave_type: string;
  duration: number;
  leave_no?: string;
  start_time?: string;
  end_time?: string;
  reason?: string;
  approval_status?: string;
}

export interface AttendanceCalendarSummary {
  attendance_days: number;
  half_days: number;
  leave_by_type: Array<{ leave_type: string; count: number; days: number }>;
  evening_overtime_hours: number;
  other_overtime_hours: number;
  late_minutes_total: number;
  early_leave_minutes_total: number;
}

export interface AttendanceCalendarData {
  employee: AttendanceCalendarEmployee;
  month: string;
  days: AttendanceCalendarDay[];
  overtimes: AttendanceCalendarOvertime[];
  leaves: AttendanceCalendarLeave[];
  summary: AttendanceCalendarSummary;
}

export interface AdminDepartment {
  id: number;
  dept_no?: string;
  dept_name: string;
  parent_id: number | null;
  parent_name?: string;
  is_locked?: boolean;
}

export interface AdminShift {
  id: number;
  shift_no: string;
  shift_name: string;
  time_slots: Array<Record<string, unknown>> | string[][];
  is_cross_day: boolean;
}

export interface AdminEmployee {
  id: number;
  emp_no: string;
  name: string;
  dept_id?: number | null;
  dept_name?: string;
  shift_no?: string;
  shift_name?: string;
  is_manager?: boolean;
  is_nursing?: boolean;
  employee_stats_attendance_source?: string;
  manager_stats_attendance_source?: string;
}

export interface AdminBootstrap {
  departments: AdminDepartment[];
  shifts: AdminShift[];
}

export interface AdminDisabledUser {
  id: number;
  username: string;
  role: "admin" | "readonly";
  profile_emp_no: string;
  profile_name: string;
  login_failed_attempts: number;
  login_locked_until: string | null;
  login_disabled_until_admin_unlock: boolean;
  login_disabled_reason: string | null;
}

export interface AdminAccountSetFactoryRestEntry {
  date: string | null;
  period: string;
  unit: number;
}

export interface AdminAccountSet {
  id: number;
  month: string;
  name: string;
  is_active: boolean;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: number | null;
  factory_rest_days: number;
  factory_rest_entries: AdminAccountSetFactoryRestEntry[];
  monthly_benefit_days: number;
  created_at: string | null;
  imports_count: number;
  pending_count: number;
  success_count: number;
  error_count: number;
  latest_import_at: string | null;
}

export interface AdminAccountSetImport {
  id: number;
  source_filename: string;
  stored_path: string;
  file_type: string;
  status: string;
  imported_count: number;
  error_message: string | null;
  created_at: string | null;
}

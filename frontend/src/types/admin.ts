export interface AdminDepartment {
  id: number;
  dept_no?: string;
  dept_name: string;
  parent_id: number | null;
}

export interface AdminShift {
  id: number;
  shift_no: string;
  shift_name: string;
  time_slots: Array<Record<string, unknown>>;
  is_cross_day: boolean;
}

export interface AdminBootstrap {
  departments: AdminDepartment[];
  shifts: AdminShift[];
}

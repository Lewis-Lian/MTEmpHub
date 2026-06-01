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
}

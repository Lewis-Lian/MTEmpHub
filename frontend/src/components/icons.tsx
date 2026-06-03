/**
 * 侧边栏菜单的内联 SVG 图标。
 * 统一使用 20×20 视口、stroke 风格，与项目现有 UI 色调一致。
 */

interface IconProps {
  className?: string;
}

const icon = (path: string) => {
  function SvgIcon({ className }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    );
  }
  SvgIcon.displayName = "SvgIcon";
  return SvgIcon;
};

/* ── 模块级图标 ── */

export const HomeIcon = icon(
  "M3 10.5L10 4l7 6.5M5 9v7a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9"
);

export const SearchIcon = icon(
  "M8.5 3a5.5 5.5 0 014.23 9.02l3.64 3.64M13 8.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
);

export const DatabaseIcon = icon(
  "M4 4h12v3H4zM4 7v3c0 .83 2.69 1.5 6 1.5s6-.67 6-1.5V7M4 10v3c0 .83 2.69 1.5 6 1.5s6-.67 6-1.5v-3"
);

export const GridIcon = icon(
  "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"
);

export const EditIcon = icon(
  "M13.5 3.5l3 3L7 16H4v-3L13.5 3.5zM11 5.5l3 3"
);

export const SettingsIcon = icon(
  "M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16.18 10a6.1 6.1 0 00-.06-.78l1.7-1.33-1.5-2.6-2.06.6a5.5 5.5 0 00-1.35-.78L12.5 3h-3l-.41 2.11a5.5 5.5 0 00-1.35.78l-2.06-.6-1.5 2.6 1.7 1.33a6.1 6.1 0 000 1.56l-1.7 1.33 1.5 2.6 2.06-.6c.41.32.86.58 1.35.78L9.5 17h3l.41-2.11c.49-.2.94-.46 1.35-.78l2.06.6 1.5-2.6-1.7-1.33c.04-.26.06-.52.06-.78z"
);

/* ── 页面级图标 ── */

export const BarChartIcon = icon(
  "M4 14h3v4H4zM8.5 10h3v8h-3zM13 6h3v12h-3z"
);

export const AlertTriangleIcon = icon(
  "M10 3L1.5 17h17L10 3zM10 7v5M10 14.5v.5"
);

export const ClockIcon = icon(
  "M10 3a7 7 0 100 14 7 7 0 000-14zM10 6v4.5l3 1.5"
);

export const BuildingIcon = icon(
  "M4 17V4h8v13M4 8h8M8 4v13M12 10h4v7h-4M2 17h16"
);

export const BriefcaseIcon = icon(
  "M3 7h14v9a1 1 0 01-1 1H4a1 1 0 01-1-1V7zM7 7V5a1 1 0 011-1h4a1 1 0 011 1v2"
);

export const CalendarIcon = icon(
  "M3 5h14v11a1 1 0 01-1 1H4a1 1 0 01-1-1V5zM3 9h14M7 3v3M13 3v3"
);

export const DownloadIcon = icon(
  "M10 3v10M6 9l4 4 4-4M3 15v2h14v-2"
);

export const UsersIcon = icon(
  "M6.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM13.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 15c0-2.5 3-3.5 3.5-3.5M11.5 11.5c.5 0 3.5 1 3.5 3.5"
);

export const SitemapIcon = icon(
  "M10 3v4M7 7h6M4 11h3v5H4zM13 11h3v5h-3zM8 11h4M10 7v4"
);

export const TimerIcon = icon(
  "M10 3a7 7 0 100 14 7 7 0 000-14zM10 1v3M7 3h6"
);

export const UserCogIcon = icon(
  "M6.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 15c0-2.5 3-3.5 3.5-3.5M14 14l2 2M14 16l2-2"
);

export const UserXIcon = icon(
  "M6.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 15c0-2.5 3-3.5 3.5-3.5M14 12l4 4M14 16l4-4"
);

export const PenIcon = icon(
  "M14.5 2.5l3 3L7 16H4v-3L14.5 2.5z"
);

export const ClockPlusIcon = icon(
  "M10 3a7 7 0 107 7M10 6v4.5l3 1.5M17 13v4M15 15h4"
);

/* ── 模块 slug → 图标映射 ── */

const moduleIconMap: Record<string, React.FC<IconProps>> = {
  home: HomeIcon,
  query: SearchIcon,
  account: DatabaseIcon,
  "master-data": GridIcon,
  corrections: EditIcon,
  settings: SettingsIcon,
};

/* ── 页面 entry key → 图标映射 ── */

const entryIconMap: Record<string, React.FC<IconProps>> = {
  query_home: HomeIcon,
  employee_dashboard: BarChartIcon,
  abnormal_query: AlertTriangleIcon,
  punch_records: ClockIcon,
  department_hours_query: BuildingIcon,
  manager_query: BriefcaseIcon,
  manager_overtime_query: ClockPlusIcon,
  manager_annual_leave_query: CalendarIcon,
  manager_department_hours_query: BuildingIcon,
  summary_download: DownloadIcon,
  account_dashboard: DatabaseIcon,
  employees: UsersIcon,
  departments: SitemapIcon,
  shifts: TimerIcon,
  employee_attendance_overrides: PenIcon,
  manager_attendance_overrides: PenIcon,
  manager_overtime: ClockPlusIcon,
  manager_annual_leave: CalendarIcon,
  accounts: UserCogIcon,
  disabled_users: UserXIcon,
  database_settings: DatabaseIcon,
};

export function getModuleIcon(slug: string): React.FC<IconProps> | null {
  return moduleIconMap[slug] ?? null;
}

export function getEntryIcon(key: string): React.FC<IconProps> | null {
  return entryIconMap[key] ?? null;
}

import type { ReactNode } from "react";
import "./query-empty-state.css";

export interface QueryEmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  className?: string;
}

export default function QueryEmptyState({
  title,
  description,
  icon,
  className = "",
}: QueryEmptyStateProps) {
  return (
    <div className={`query-empty-state ${className}`.trim()}>
      <div className="empty-visual-badge">
        {icon ?? (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
            <rect x="15" y="4" width="7" height="6" rx="1" />
          </svg>
        )}
      </div>
      <div className="empty-text-wrap">
        <div className="empty-title">{title}</div>
        <p className="empty-desc">{description}</p>
      </div>
    </div>
  );
}

/* ==========================================================================
   各页面专属语义化矢量图标组件 (SVG Icons)
   ========================================================================== */

/** 单人考勤图标：个人档案与日历看板 */
export function IndividualAttendanceIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <rect x="16" y="3" width="6" height="6" rx="1.5" />
      <path d="M18 5h2" />
    </svg>
  );
}

/** 员工考勤数据图标：团队多维数据看板 */
export function TeamDashboardIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** 考勤异常图标：时钟告警/感叹号 */
export function AbnormalAlertIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 14.5 14.5" />
      <path d="M12 2v2" />
      <circle cx="19.5" cy="5.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** 打卡记录图标：打卡流/时钟/时间戳 */
export function PunchRecordIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <polyline points="9 14 11 16 15 12" />
      <line x1="8" y1="2" x2="8" y2="5" />
      <line x1="16" y1="2" x2="16" y2="5" />
    </svg>
  );
}

/** 部门工时图标：组织架构/楼宇与柱状图 */
export function DepartmentHoursIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <line x1="8" y1="6" x2="10" y2="6" />
      <line x1="14" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="10" y2="10" />
      <line x1="14" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="10" y2="14" />
      <line x1="14" y1="14" x2="16" y2="14" />
    </svg>
  );
}

/** 管理人员考勤图标：管理者领带/公文包 */
export function ManagerQueryIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M12 12v3" />
      <path d="M8 12h8" />
    </svg>
  );
}

/** 管理人员加班图标：加班沙漏/时钟 */
export function ManagerOvertimeIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <polyline points="12 9 12 13 15 15" />
      <path d="M12 2v3" />
      <path d="M10 2h4" />
      <path d="M19 6l2-2" />
    </svg>
  );
}

/** 管理人员年休假图标：年休假/棕榈日历 */
export function ManagerAnnualLeaveIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M12 14c-1.5-1.5-3.5-1.5-4 0 1.5 1.5 3.5 1.5 4 0z" fill="currentColor" opacity="0.3" />
      <circle cx="12" cy="15" r="2" />
    </svg>
  );
}

/** 管理人员部门工时图标：部门统计图表 */
export function ManagerDepartmentHoursIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

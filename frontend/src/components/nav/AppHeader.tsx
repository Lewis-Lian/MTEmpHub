import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../api/auth";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";
import { applyTheme, getStoredThemeMode, getSystemTheme, setStoredThemeMode, type ThemeMode } from "../../utils/theme";
import { getSearchShortcutKey } from "../../utils/platform";
import "../../styles/components/app-header.css";

interface AppHeaderProps {
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  isSidebarCollapsed?: boolean;
  matchedLabel?: string;
  onLogout: () => void;
  onOpenSearch?: () => void;
  onRefreshCurrent: () => void;
  onToggleSidebar?: () => void;
  user: AuthUser;
}

export function formatDepartmentDisplay(deptName?: string | null): string {
  if (!deptName || !deptName.trim()) {
    return "-";
  }
  const clean = deptName.trim();
  const segments = clean.split(/[-/—>]/);
  const lastSegment = segments[segments.length - 1]?.trim();
  return lastSegment || clean;
}

export default function AppHeader({
  currentEntry,
  currentModule,
  matchedLabel,
  onLogout,
  onOpenSearch,
  onRefreshCurrent,
  user,
}: AppHeaderProps) {
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    themeMode === "auto" ? getSystemTheme() : themeMode
  );
  const [searchShortcut] = useState<string>(() => getSearchShortcutKey());

  useEffect(() => {
    const activeTheme = applyTheme(themeMode);
    setResolvedTheme(activeTheme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (themeMode === "auto") {
        const next = applyTheme("auto");
        setResolvedTheme(next);
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [themeMode]);

  const handleToggleTheme = () => {
    // 循环切换模式: auto (跟随系统) -> dark (深色) -> light (浅色)
    const nextMode: ThemeMode =
      themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto";
    setThemeMode(nextMode);
    const active = setStoredThemeMode(nextMode);
    setResolvedTheme(active);
  };

  const getThemeTitle = () => {
    if (themeMode === "auto") {
      return `当前模式：跟随系统（当前生效: ${resolvedTheme === "dark" ? "深色" : "浅色"}，点击切换为深色模式）`;
    }
    if (themeMode === "dark") {
      return "当前模式：深色模式（点击切换为浅色模式）";
    }
    return "当前模式：浅色模式（点击切换为跟随系统）";
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefreshCurrent();
    window.setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const roleLabel = user.role === "admin" ? "管理员" : "只读用户";
  const parentLabel = currentModule?.label ?? "仪表盘";
  const childLabel = currentEntry?.label ?? matchedLabel ?? "分析看板";

  const empNo = user.profile_emp_no?.trim() || "-";
  const empName = user.profile_name?.trim() || "-";
  const rawDept = user.dept_name || user.profile_department?.dept_name;
  const deptDisplay = formatDepartmentDisplay(rawDept);

  return (
    <header className="app-header" aria-label="顶部操作栏">
      <div className="app-header-left">
        <button
          aria-label="刷新页面"
          className={`app-header-icon-btn${isRefreshing ? " is-refreshing" : ""}`}
          onClick={handleRefresh}
          title="刷新页面"
          type="button"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 8A6 6 0 1 1 8 2c2.4 0 4.5 1.4 5.5 3.5M14 2v4h-4" />
          </svg>
        </button>

        <nav className="app-header-breadcrumb" aria-label="面包屑导航">
          <span className="app-header-breadcrumb-parent">{parentLabel}</span>
          <span className="app-header-breadcrumb-separator" aria-hidden="true">/</span>
          <span className="app-header-breadcrumb-current">{childLabel}</span>
        </nav>
      </div>

      <div className="app-header-right">
        <div
          className="app-header-search"
          onClick={onOpenSearch}
          role="button"
          tabIndex={0}
          title={`点击或按 ${searchShortcut} 搜索页面`}
        >
          <span className="app-header-search-icon" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
          </span>
          <span className="app-header-search-text">搜索</span>
          <kbd className="app-header-search-badge">{searchShortcut}</kbd>
        </div>

        <button
          aria-label="全屏切换"
          className="app-header-icon-btn"
          onClick={handleToggleFullscreen}
          title="全屏切换"
          type="button"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5M10.5 2.5H13a.5.5 0 0 1 .5.5v2.5M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5M5.5 13.5H3a.5.5 0 0 1-.5-.5v-2.5" />
          </svg>
        </button>

        <button
          aria-label={getThemeTitle()}
          className={`app-header-icon-btn app-header-theme-btn${themeMode === "auto" ? " is-auto-mode" : ""}`}
          data-theme-mode={themeMode}
          onClick={handleToggleTheme}
          title={getThemeTitle()}
          type="button"
        >
          {themeMode === "auto" ? (
            /* 电脑屏幕/系统设备图标（跟随系统） */
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
              <line x1="8" y1="11" x2="8" y2="13.5" />
              <line x1="5" y1="13.5" x2="11" y2="13.5" />
            </svg>
          ) : themeMode === "dark" ? (
            /* 月亮图标（深色模式） */
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 9.8A6 6 0 1 1 6.2 2.5 4.8 4.8 0 0 0 13.5 9.8z" />
            </svg>
          ) : (
            /* 太阳图标（浅色模式） */
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3" />
              <line x1="8" y1="1" x2="8" y2="2.5" />
              <line x1="8" y1="13.5" x2="8" y2="15" />
              <line x1="1" y1="8" x2="2.5" y2="8" />
              <line x1="13.5" y1="8" x2="15" y2="8" />
              <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" />
              <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" />
              <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" />
              <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" />
            </svg>
          )}
        </button>

        <div
          className="app-header-avatar-wrap"
          onMouseEnter={() => setIsUserMenuOpen(true)}
          onMouseLeave={() => setIsUserMenuOpen(false)}
        >
          <button
            aria-label={`用户头像：${user.username}`}
            className="app-header-avatar-btn"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            type="button"
          >
            <svg className="app-header-avatar-img" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="#cbd5e1" />
              <path d="M8 12c0-3.5 3.5-5.5 8-5.5s8 2 8 5.5l3.5 1-3.5 1.5H8z" fill="#1e293b" />
              <circle cx="16" cy="17" r="5.5" fill="#fed7aa" />
              <path d="M10 16c0 3.5 1.5 6 1.5 6M22 16c0 3.5-1.5 6-1.5 6" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#475569" />
            </svg>
          </button>

          <div className={`app-header-user-menu${isUserMenuOpen ? " is-open" : ""}`} role="menu">
            {/* 用户顶部卡片 */}
            <div className="app-header-user-card">
              <div className="app-header-user-card-avatar">
                <svg viewBox="0 0 32 32" fill="none" width="36" height="36">
                  <circle cx="16" cy="16" r="16" fill="#cbd5e1" />
                  <path d="M8 12c0-3.5 3.5-5.5 8-5.5s8 2 8 5.5l3.5 1-3.5 1.5H8z" fill="#1e293b" />
                  <circle cx="16" cy="17" r="5.5" fill="#fed7aa" />
                  <path d="M10 16c0 3.5 1.5 6 1.5 6M22 16c0 3.5-1.5 6-1.5 6" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#475569" />
                </svg>
                <span className="app-header-user-online-dot" title="账号在线" />
              </div>
              <div className="app-header-user-meta">
                <div className="app-header-user-name">{user.username}</div>
                {/* 身份标头的角色标签如果是管理员就显示，不是就不显示 */}
                {user.role === "admin" && (
                  <div className="app-header-user-badge">{roleLabel}</div>
                )}
              </div>
            </div>

            {/* 账号信息：工号、姓名、部门 */}
            <div className="app-header-user-details">
              <div className="app-header-detail-item">
                <span className="detail-label">工号：</span>
                <span className="detail-value">{empNo}</span>
              </div>
              <div className="app-header-detail-item">
                <span className="detail-label">姓名：</span>
                <span className="detail-value">{empName}</span>
              </div>
              <div className="app-header-detail-item">
                <span className="detail-label">部门：</span>
                <span className="detail-value">{deptDisplay}</span>
              </div>
            </div>

            {/* 快捷操作与安全设置 */}
            <div className="app-header-user-actions-list">
              <button
                className="app-header-action-link"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  navigate("/change-password");
                }}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
                </svg>
                <span>修改密码</span>
              </button>
            </div>

            {/* 退出登录 */}
            <div className="app-header-user-footer">
              <button
                className="top-nav-logout"
                onClick={onLogout}
                type="button"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

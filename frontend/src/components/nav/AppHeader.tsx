import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../api/auth";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";
import { applyTheme, getStoredThemeMode, getSystemTheme, setStoredThemeMode, type ThemeMode } from "../../utils/theme";
import { getSearchShortcutKey } from "../../utils/platform";
import "../../styles/components/app-header.css";
import MessageCenter from "./MessageCenter";
import UserAvatar from "../common/UserAvatar";
import AvatarChangeModal from "../common/AvatarChangeModal";

interface AppHeaderProps {
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  isSidebarCollapsed?: boolean;
  matchedLabel?: string;
  onLogout: () => void;
  onOpenSearch?: () => void;
  onRefreshCurrent: () => void;
  onToggleSidebar?: () => void;
  onUserUpdate?: (user: AuthUser) => void;
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
  onUserUpdate,
  user,
}: AppHeaderProps) {
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    themeMode === "auto" ? getSystemTheme() : themeMode
  );
  const [searchShortcut] = useState<string>(() => getSearchShortcutKey());
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserMenuOpen]);

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

        <MessageCenter />

        <div
          className="app-header-avatar-wrap"
          ref={userMenuRef}
          onMouseEnter={() => setIsUserMenuOpen(true)}
          onMouseLeave={() => setIsUserMenuOpen(false)}
        >
          <button
            aria-label={`用户头像：${user.username}`}
            className={`app-header-avatar-btn${isUserMenuOpen ? " is-active" : ""}`}
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            type="button"
          >
            <UserAvatar avatar={user.avatar} name={user.profile_name || user.username} size={32} />
          </button>

          <div className={`app-header-user-menu${isUserMenuOpen ? " is-open" : ""}`} role="menu">
            {/* 用户顶部卡片 */}
            <div className="app-header-user-card">
              <div
                aria-label="更换头像"
                className="app-header-user-card-avatar"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setIsAvatarModalOpen(true);
                }}
                role="button"
                tabIndex={0}
                title="点击更换头像"
              >
                <UserAvatar avatar={user.avatar} name={user.profile_name || user.username} size={38} />
                <span className="app-header-user-online-dot" title="账号在线" />
                <div className="app-header-avatar-edit-mask">
                  <svg
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
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
                <span className="detail-label">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <line x1="6" y1="9" x2="10" y2="9"/>
                    <line x1="6" y1="13" x2="14" y2="13"/>
                  </svg>
                  工号：
                </span>
                <span className="detail-value">{empNo}</span>
              </div>
              <div className="app-header-detail-item">
                <span className="detail-label">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  姓名：
                </span>
                <span className="detail-value">{empName}</span>
              </div>
              <div className="app-header-detail-item">
                <span className="detail-label">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2"/>
                    <path d="M9 22v-4h6v4"/>
                  </svg>
                  部门：
                </span>
                <span className="detail-value">{deptDisplay}</span>
              </div>
            </div>

            {/* 快捷操作与安全设置 */}
            <div className="app-header-user-actions-list">
              <button
                className="app-header-action-link"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setIsAvatarModalOpen(true);
                }}
                type="button"
              >
                <div className="app-header-action-link-left">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="10" r="3" />
                    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
                  </svg>
                  <span>修改头像</span>
                </div>
                <svg className="app-header-action-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 12l4-4-4-4" />
                </svg>
              </button>
              <button
                className="app-header-action-link"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  navigate("/change-password");
                }}
                type="button"
              >
                <div className="app-header-action-link-left">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="7" width="10" height="7" rx="1.5" />
                    <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
                  </svg>
                  <span>修改密码</span>
                </div>
                <svg className="app-header-action-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 12l4-4-4-4" />
                </svg>
              </button>
            </div>

            {/* 退出登录 */}
            <div className="app-header-user-footer">
              <button
                className="top-nav-logout"
                onClick={onLogout}
                type="button"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>退出登录</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <AvatarChangeModal
        isOpen={isAvatarModalOpen}
        onClose={() => setIsAvatarModalOpen(false)}
        onUserUpdate={onUserUpdate}
        user={user}
      />
    </header>
  );
}

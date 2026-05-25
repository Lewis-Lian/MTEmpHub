import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { logout, type AuthUser } from "../api/auth";
import { fetchNavigation } from "../api/query";
import AppMenu from "../components/nav/AppMenu";
import AppTabs, { type AppTabItem } from "../components/nav/AppTabs";
import ErrorState from "../components/feedback/ErrorState";
import LoadingState from "../components/feedback/LoadingState";
import type { QueryNavigationModule } from "../types/query";

interface AppShellProps {
  onLogout: (user: AuthUser | null) => void;
  user: AuthUser;
}

export default function AppShell({ onLogout, user }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [modules, setModules] = useState<QueryNavigationModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<AppTabItem[]>([]);
  const [tabReloadKey, setTabReloadKey] = useState(0);

  const matchedNavigation = useMemo(() => {
    for (const module of modules) {
      if (module.home_href === location.pathname) {
        return {
          module,
          entry: null,
          label: module.label,
        };
      }

      const matchedEntry = module.entries.find((entry) => entry.href === location.pathname);
      if (matchedEntry) {
        return {
          module,
          entry: matchedEntry,
          label: matchedEntry.label,
        };
      }
    }

    return null;
  }, [location.pathname, modules]);

  useEffect(() => {
    let mounted = true;

    async function loadNavigation() {
      try {
        const payload = await fetchNavigation();
        if (!mounted) {
          return;
        }
        setModules(payload.modules.map(normalizeModuleHomeHref));
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          onLogout(null);
          navigate("/login", { replace: true });
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "导航加载失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadNavigation();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading || error) {
      return;
    }

    const nextTab: AppTabItem = {
      href: location.pathname,
      label: matchedNavigation?.label ?? "当前页面",
    };

    setTabs((currentTabs) => {
      const existingIndex = currentTabs.findIndex((tab) => tab.href === nextTab.href);
      if (existingIndex >= 0) {
        return currentTabs.map((tab, index) => (index === existingIndex ? nextTab : tab));
      }
      return [...currentTabs, nextTab];
    });
  }, [error, isLoading, location.pathname, matchedNavigation]);

  async function handleLogout() {
    await logout();
    onLogout(null);
    navigate("/login", { replace: true });
  }

  function handleNavigateTab(href: string) {
    navigate(href);
  }

  function handleRefreshTab(href: string) {
    navigate(href, { replace: true });
    if (href === location.pathname) {
      setTabReloadKey((current) => current + 1);
    }
  }

  function handleCloseTab(href: string) {
    if (tabs.length <= 1) {
      return;
    }

    const closingIndex = tabs.findIndex((tab) => tab.href === href);
    if (closingIndex < 0) {
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.href !== href);
    const fallbackTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null;

    setTabs(nextTabs);

    if (href === location.pathname && fallbackTab) {
      navigate(fallbackTab.href);
    }
  }

  const currentModule = matchedNavigation?.module ?? modules[0] ?? null;
  const currentEntry = matchedNavigation?.entry ?? null;
  const roleLabel = user.role === "admin" ? "管理员" : "只读用户";

  return (
    <div className="app-layout">
      <header className="top-nav">
        <div className="top-nav-inner">
          <AppMenu
            currentEntry={currentEntry}
            currentModule={currentModule}
            mode="top"
            modules={modules}
          />
          <div className="top-nav-actions">
            <div className="top-nav-user">
              <span className="top-nav-user-code">{user.username}</span>
              <span className="top-nav-user-person">{matchedNavigation?.label ?? "欢迎使用考勤系统"}</span>
              <span className="top-nav-user-role">{roleLabel}</span>
            </div>
            <button className="top-nav-logout" onClick={handleLogout} type="button">
              退出登录
            </button>
          </div>
        </div>
      </header>
      <div className="app-workspace">
        <aside className="app-sidebar">
          <div className="app-sidebar-brand">
            <h1>考勤系统</h1>
            <p>当前模块：{currentModule?.label ?? "系统导航"}</p>
            <p>当前用户：{user.username}</p>
          </div>
          {isLoading ? <div className="app-sidebar-hint">正在加载菜单...</div> : null}
          {error ? <div className="app-sidebar-error">{error}</div> : null}
          {!isLoading && !error ? (
            <AppMenu
              currentEntry={currentEntry}
              currentModule={currentModule}
              mode="side"
              modules={modules}
            />
          ) : null}
          <button className="app-logout-button" onClick={handleLogout} type="button">
            退出登录
          </button>
        </aside>
        <main className="app-main">
          {!isLoading && !error ? (
            <AppTabs
              currentPath={location.pathname}
              onCloseTab={handleCloseTab}
              onNavigate={handleNavigateTab}
              onRefreshTab={handleRefreshTab}
              tabs={tabs}
            />
          ) : null}
          <div className="app-content">
            {isLoading ? <LoadingState message="正在准备导航..." /> : null}
            {error ? <ErrorState description={error} title="导航加载失败" /> : null}
            {!isLoading && !error ? <Outlet key={`${location.pathname}:${tabReloadKey}`} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function normalizeModuleHomeHref(module: QueryNavigationModule): QueryNavigationModule {
  const defaultEntryHref = module.entries[0]?.href;

  if (!defaultEntryHref || module.home_href === defaultEntryHref) {
    return module;
  }

  return {
    ...module,
    home_href: defaultEntryHref,
  };
}

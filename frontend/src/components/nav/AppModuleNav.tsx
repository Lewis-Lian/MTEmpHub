import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";
import { getModuleIcon, getEntryIcon } from "../icons";
import "../../styles/components/app-nav.css";

interface AppModuleNavProps {
  collapsed: boolean;
  currentEntry?: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
}

export default function AppModuleNav({
  collapsed,
  currentEntry,
  currentModule,
  modules,
}: AppModuleNavProps) {
  const navigate = useNavigate();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(() => {
    return currentModule?.slug && currentModule.slug !== "home" ? currentModule.slug : null;
  });

  useEffect(() => {
    if (currentModule?.slug && currentModule.slug !== "home") {
      setExpandedSlug(currentModule.slug);
    }
  }, [currentModule?.slug]);

  const handleModuleClick = (module: QueryNavigationModule) => {
    if (collapsed || module.entries.length === 0) {
      navigate(module.home_href);
      return;
    }

    setExpandedSlug((prev) => (prev === module.slug ? null : module.slug));
  };

  return (
    <div className="app-page-nav-shell">
      <nav className="app-accordion-nav" aria-label="系统导航目录">
        {modules.map((module) => {
          const Icon = getModuleIcon(module.slug);
          const isCurrentModule = currentModule?.slug === module.slug;
          const isDirectLink =
            module.slug === "home" ||
            module.entries.length === 0 ||
            (module.entries.length === 1 && module.entries[0]?.href === module.home_href);
          const hasEntries = !isDirectLink && module.entries.length > 0;
          const isExpanded = !collapsed && hasEntries && expandedSlug === module.slug;

          return (
            <div className={`app-nav-group${isExpanded ? " is-expanded" : ""}`} key={module.slug}>
              {isDirectLink ? (
                <NavLink
                  to={module.home_href}
                  className={({ isActive }) =>
                    `app-module-link${isActive || isCurrentModule ? " is-active" : ""}`
                  }
                  title={collapsed ? module.label : undefined}
                >
                  {Icon && <Icon className="nav-icon" />}
                  {!collapsed && <span className="app-module-link-label">{module.label}</span>}
                </NavLink>
              ) : (
                <button
                  type="button"
                  className={`app-module-link${isCurrentModule ? " is-active" : ""}`}
                  title={collapsed ? module.label : undefined}
                  onClick={() => handleModuleClick(module)}
                  aria-expanded={hasEntries ? isExpanded : undefined}
                >
                  {Icon && <Icon className="nav-icon" />}
                  {!collapsed && (
                    <>
                      <span className="app-module-link-label">{module.label}</span>
                      <span className={`app-module-chevron${isExpanded ? " is-expanded" : ""}`} aria-hidden="true">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="4 6 8 10 12 6" />
                        </svg>
                      </span>
                    </>
                  )}
                </button>
              )}

              {hasEntries && (
                <div className={`app-module-subnav${isExpanded ? " is-expanded" : ""}`}>
                  {module.entries.map((entry) => {
                    const EntryIcon = getEntryIcon(entry.key);
                    const isEntryActive = currentEntry?.key === entry.key;

                    return (
                      <NavLink
                        key={entry.key}
                        to={entry.href}
                        title={collapsed ? entry.label : undefined}
                        className={({ isActive }) =>
                          `app-side-link${isActive || isEntryActive ? " is-active" : ""}`
                        }
                      >
                        {EntryIcon && <EntryIcon className="nav-icon" />}
                        {!collapsed && <span className="app-side-label">{entry.label}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

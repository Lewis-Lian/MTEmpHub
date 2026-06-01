import { NavLink } from "react-router-dom";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";

interface AppPageNavProps {
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
}

export default function AppPageNav({ currentEntry, currentModule, modules }: AppPageNavProps) {
  const sidebarEntries = currentModule?.entries ?? [];

  return (
    <div className="app-page-nav-shell">
      <nav className="app-page-nav" aria-label="页面导航">
        <div className="app-sidebar-section">
          <p className="app-sidebar-caption">{currentModule?.label ?? "系统导航"}</p>
        </div>
        <div className="app-sidebar-nav">
          {sidebarEntries.map((entry) => (
            <NavLink
              className={({ isActive }) =>
                `app-side-link${isActive || currentEntry?.key === entry.key ? " is-active" : ""}`
              }
              key={entry.key}
              to={entry.href}
            >
              <span className="app-side-label">{entry.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <nav className="module-bottom-nav" aria-label="移动端模块导航">
        <div className="module-bottom-modules">
          {modules.map((module) => (
            <NavLink
              className={({ isActive }) =>
                `module-bottom-link${
                  isActive || currentModule?.slug === module.slug ? " is-active" : ""
                }`
              }
              key={`${module.slug}-bottom`}
              to={module.home_href}
            >
              {module.short_label || module.label}
            </NavLink>
          ))}
        </div>
        <div className="module-bottom-sidebar">
          {sidebarEntries.map((entry) => (
            <NavLink
              className={({ isActive }) =>
                `app-side-link${isActive || currentEntry?.key === entry.key ? " is-active" : ""}`
              }
              key={`${entry.key}-bottom`}
              to={entry.href}
            >
              <span className="app-side-label">{entry.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

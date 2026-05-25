import { NavLink } from "react-router-dom";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";

interface AppMenuProps {
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
  mode: "top" | "side";
}

export default function AppMenu({ currentEntry, currentModule, mode, modules }: AppMenuProps) {
  const sidebarEntries = currentModule?.entries ?? [];

  if (mode === "top") {
    return (
      <nav className="app-top-modules" aria-label="模块导航">
        {modules.map((module) => (
          <NavLink
            className={({ isActive }) =>
              `app-top-module${
                isActive || currentModule?.slug === module.slug ? " is-active" : ""
              }`
            }
            key={module.slug}
            to={module.home_href}
          >
            <span className="app-top-module-label">{module.label}</span>
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <div className="app-menu-shell">
      <div className="app-module-sidebar">
        <div className="app-sidebar-section">
          <p className="app-sidebar-caption">{currentModule?.label ?? "系统导航"}</p>
        </div>
        <div className="app-sidebar-nav">
          {sidebarEntries.map((entry) => (
            <NavLink
              className={({ isActive }) =>
                `app-side-link${
                  isActive || currentEntry?.key === entry.key ? " is-active" : ""
                }`
              }
              key={entry.key}
              to={entry.href}
            >
              <span className="app-side-label">{entry.label}</span>
              {entry.description ? <small>{entry.description}</small> : null}
            </NavLink>
          ))}
        </div>
      </div>
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
                `app-side-link${
                  isActive || currentEntry?.key === entry.key ? " is-active" : ""
                }`
              }
              key={`${entry.key}-bottom`}
              to={entry.href}
            >
              <span className="app-side-label">{entry.label}</span>
              {entry.description ? <small>{entry.description}</small> : null}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

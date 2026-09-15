import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import type { QueryNavigationEntry, QueryNavigationModule } from "../../types/query";
import { getModuleIcon, getEntryIcon } from "../icons";
import "../../styles/components/app-nav.css";

interface AppPageNavProps {
  collapsed: boolean;
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
}

export default function AppPageNav({ currentEntry, currentModule, modules }: AppPageNavProps) {
  const sidebarEntries = currentModule?.entries ?? [];

  return (
    <nav className="module-bottom-nav" aria-label="移动端模块导航">
        <div className="module-bottom-modules">
          {modules.map((module) => {
            const Icon = getModuleIcon(module.slug);
            return (
              <NavLink
                className={({ isActive }) =>
                  `module-bottom-link${
                    isActive || currentModule?.slug === module.slug ? " is-active" : ""
                  }`
                }
                key={`${module.slug}-bottom`}
                to={module.home_href}
              >
                {Icon && <Icon className="nav-icon" />}
                {module.short_label || module.label}
              </NavLink>
            );
          })}
        </div>
        <div className="module-bottom-sidebar">
          {sidebarEntries.map((entry, index) => {
            const Icon = getEntryIcon(entry.key);
            const showGroupTitle = Boolean(entry.group) && sidebarEntries[index - 1]?.group !== entry.group;

            return (
              <Fragment key={`${entry.key}-bottom`}>
                {showGroupTitle && <div className="app-nav-group-title">{entry.group}</div>}
                <NavLink
                  className={({ isActive }) =>
                    `app-side-link${isActive || currentEntry?.key === entry.key ? " is-active" : ""}`
                  }
                  to={entry.href}
                >
                  {Icon && <Icon className="nav-icon" />}
                  <span className="app-side-label">{entry.label}</span>
                </NavLink>
              </Fragment>
            );
          })}
        </div>
      </nav>
  );
}

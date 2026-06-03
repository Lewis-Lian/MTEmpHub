import { NavLink } from "react-router-dom";
import type { QueryNavigationModule } from "../../types/query";
import { getModuleIcon } from "../icons";

interface AppModuleNavProps {
  collapsed: boolean;
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
}

export default function AppModuleNav({ collapsed, currentModule, modules }: AppModuleNavProps) {
  return (
    <nav className="app-module-nav" aria-label="模块导航">
      {modules.map((module) => {
        const Icon = getModuleIcon(module.slug);
        return (
          <NavLink
            className={({ isActive }) =>
              `app-module-link${isActive || currentModule?.slug === module.slug ? " is-active" : ""}`
            }
            key={module.slug}
            title={collapsed ? module.label : undefined}
            to={module.home_href}
          >
            {Icon && <Icon className="nav-icon" />}
            {!collapsed && <span className="app-module-link-label">{module.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

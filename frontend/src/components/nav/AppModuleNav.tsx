import { NavLink } from "react-router-dom";
import type { QueryNavigationModule } from "../../types/query";

interface AppModuleNavProps {
  currentModule: QueryNavigationModule | null;
  modules: QueryNavigationModule[];
}

export default function AppModuleNav({ currentModule, modules }: AppModuleNavProps) {
  return (
    <nav className="app-module-nav" aria-label="模块导航">
      {modules.map((module) => (
        <NavLink
          className={({ isActive }) =>
            `app-module-link${isActive || currentModule?.slug === module.slug ? " is-active" : ""}`
          }
          key={module.slug}
          to={module.home_href}
        >
          <span className="app-module-link-label">{module.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

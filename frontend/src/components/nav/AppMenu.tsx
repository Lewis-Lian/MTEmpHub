import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import type { QueryNavigationModule } from "../../types/query";

interface AppMenuProps {
  modules: QueryNavigationModule[];
}

export default function AppMenu({ modules }: AppMenuProps) {
  return (
    <div style={menuStyle}>
      {modules.map((module) => (
        <section key={module.slug} style={moduleStyle}>
          <p style={moduleLabelStyle}>{module.label}</p>
          <div style={entriesStyle}>
            {module.entries.map((entry) => (
              <NavLink
                key={entry.key}
                style={({ isActive }) => ({
                  ...entryStyle,
                  ...(isActive ? activeEntryStyle : null),
                })}
                to={entry.href}
              >
                <span style={entryTitleStyle}>{entry.label}</span>
                {entry.description ? <span style={entryMetaStyle}>{entry.description}</span> : null}
              </NavLink>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const menuStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const moduleStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const moduleLabelStyle: CSSProperties = {
  margin: 0,
  color: "rgba(247, 244, 234, 0.64)",
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

const entriesStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const entryStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "12px 14px",
  borderRadius: "16px",
  color: "#f7f4ea",
  textDecoration: "none",
  background: "rgba(247, 244, 234, 0.04)",
  border: "1px solid rgba(247, 244, 234, 0.08)",
};

const activeEntryStyle: CSSProperties = {
  background: "rgba(244, 201, 93, 0.16)",
  borderColor: "rgba(244, 201, 93, 0.36)",
};

const entryTitleStyle: CSSProperties = {
  fontWeight: 600,
  lineHeight: 1.4,
};

const entryMetaStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.5,
  color: "rgba(247, 244, 234, 0.72)",
};

import type { CSSProperties } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { logout, type AuthUser } from "../api/auth";

interface AppShellProps {
  onLogout: (user: AuthUser | null) => void;
  user: AuthUser;
}

export default function AppShell({ onLogout, user }: AppShellProps) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    onLogout(null);
    navigate("/login", { replace: true });
  }

  return (
    <div style={shellStyle}>
      <aside style={sidebarStyle}>
        <div>
          <h1 style={titleStyle}>考勤系统</h1>
          <p style={metaStyle}>当前用户：{user.username}</p>
          <p style={metaStyle}>角色：{user.role}</p>
        </div>
        <nav style={navStyle}>
          <Link style={linkStyle} to="/employee/dashboard">
            员工首页
          </Link>
        </nav>
        <button onClick={handleLogout} style={buttonStyle} type="button">
          退出登录
        </button>
      </aside>
      <main style={mainStyle}>
        <Outlet />
      </main>
    </div>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  gridTemplateColumns: "240px 1fr",
  background: "linear-gradient(180deg, #f3f6ef 0%, #fcfbf7 100%)",
  color: "#183153",
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
};

const sidebarStyle: CSSProperties = {
  padding: "32px 20px",
  background: "#183153",
  color: "#f7f4ea",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
};

const metaStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "14px",
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const linkStyle: CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  padding: "10px 12px",
  border: "1px solid rgba(247, 244, 234, 0.25)",
  borderRadius: "10px",
};

const buttonStyle: CSSProperties = {
  marginTop: "auto",
  border: "none",
  borderRadius: "10px",
  padding: "12px 14px",
  background: "#f4c95d",
  color: "#183153",
  cursor: "pointer",
  fontWeight: 600,
};

const mainStyle: CSSProperties = {
  padding: "40px",
};

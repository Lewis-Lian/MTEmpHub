import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { logout, type AuthUser } from "../api/auth";
import { fetchNavigation } from "../api/query";
import AppMenu from "../components/nav/AppMenu";
import ErrorState from "../components/feedback/ErrorState";
import LoadingState from "../components/feedback/LoadingState";
import type { QueryNavigationModule } from "../types/query";

interface AppShellProps {
  onLogout: (user: AuthUser | null) => void;
  user: AuthUser;
}

export default function AppShell({ onLogout, user }: AppShellProps) {
  const navigate = useNavigate();
  const [modules, setModules] = useState<QueryNavigationModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadNavigation() {
      try {
        const payload = await fetchNavigation();
        if (!mounted) {
          return;
        }
        setModules(payload.modules);
        setError("");
      } catch (caughtError) {
        if (!mounted) {
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
        {isLoading ? <div style={loadingHintStyle}>正在加载菜单...</div> : null}
        {error ? <div style={errorHintStyle}>{error}</div> : null}
        {!isLoading && !error ? <AppMenu modules={modules} /> : null}
        <button onClick={handleLogout} style={buttonStyle} type="button">
          退出登录
        </button>
      </aside>
      <main style={mainStyle}>
        {isLoading ? <LoadingState message="正在准备导航..." /> : null}
        {error ? <ErrorState description={error} title="导航加载失败" /> : null}
        {!isLoading && !error ? <Outlet /> : null}
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

const loadingHintStyle: CSSProperties = {
  color: "rgba(247, 244, 234, 0.76)",
  fontSize: "14px",
};

const errorHintStyle: CSSProperties = {
  color: "#fecaca",
  fontSize: "14px",
  lineHeight: 1.6,
};

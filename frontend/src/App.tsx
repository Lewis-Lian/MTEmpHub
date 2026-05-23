import { useEffect, useState } from "react";
import { ApiError } from "./api/client";
import { fetchMe, type AuthUser } from "./api/auth";
import AppRouter from "./router";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const currentUser = await fetchMe();
        if (isMounted) {
          setUser(currentUser);
          setInitError("");
        }
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }

        if (caughtError instanceof ApiError && caughtError.status === 401) {
          setUser(null);
          setInitError("");
        } else {
          console.error(caughtError);
          setInitError("初始化失败，请检查后端服务或网络连接后刷新重试。");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return <div style={loadingStyle}>正在初始化前端应用...</div>;
  }

  if (initError) {
    return (
      <div style={loadingStyle}>
        <div style={errorCardStyle}>
          <h1 style={errorTitleStyle}>前端初始化失败</h1>
          <p style={errorBodyStyle}>{initError}</p>
        </div>
      </div>
    );
  }

  return <AppRouter isLoading={isLoading} onLogin={setUser} onLogout={setUser} user={user} />;
}

const loadingStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
};

const errorCardStyle = {
  maxWidth: "420px",
  padding: "24px 28px",
  borderRadius: "20px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
  color: "#183153",
};

const errorTitleStyle = {
  margin: "0 0 12px",
  fontSize: "28px",
};

const errorBodyStyle = {
  margin: 0,
  lineHeight: 1.7,
  color: "#4b5d67",
};

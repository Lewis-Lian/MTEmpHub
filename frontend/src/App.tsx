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
    return (
      <div className="legacy-page-center">
        <div className="legacy-panel">正在初始化前端应用...</div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="legacy-page-center">
        <div className="legacy-panel legacy-content-panel">
          <h1 className="legacy-panel-title">前端初始化失败</h1>
          <p className="legacy-panel-body">{initError}</p>
        </div>
      </div>
    );
  }

  return <AppRouter isLoading={isLoading} onLogin={setUser} onLogout={setUser} user={user} />;
}

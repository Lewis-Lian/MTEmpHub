import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchAdminBootstrap } from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";

export default function AdminDashboardPage() {
  const [departmentCount, setDepartmentCount] = useState(0);
  const [shiftCount, setShiftCount] = useState(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadBootstrap() {
      try {
        const payload = await fetchAdminBootstrap();
        if (!mounted) {
          return;
        }
        setDepartmentCount(payload.departments.length);
        setShiftCount(payload.shifts.length);
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "后台首页初始化失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadBootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return <LoadingState message="正在加载后台首页..." />;
  }

  if (error) {
    return <ErrorState description={error} title="后台首页加载失败" />;
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <p style={tagStyle}>后台管理</p>
        <h2 style={titleStyle}>账套与主数据入口</h2>
        <p style={descriptionStyle}>React 前端已经接管后台入口。复杂编辑流程会在后续任务继续迁移，这里先保证独立前端下的导航与核心列表可用。</p>
      </header>
      <section style={gridStyle}>
        <article style={metricStyle}>
          <p style={metricLabelStyle}>部门数量</p>
          <strong style={metricValueStyle}>{departmentCount}</strong>
        </article>
        <article style={metricStyle}>
          <p style={metricLabelStyle}>班次数量</p>
          <strong style={metricValueStyle}>{shiftCount}</strong>
        </article>
      </section>
    </section>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
};

const heroStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const tagStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  color: "#183153",
};

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: "#4b5d67",
  lineHeight: 1.7,
  maxWidth: "820px",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const metricStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};

const metricLabelStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
};

const metricValueStyle: CSSProperties = {
  display: "block",
  marginTop: "12px",
  fontSize: "32px",
  color: "#183153",
};

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchHomeSummary, fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { QueryBootstrap } from "../../types/query";

export default function QueryHomePage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [month, setMonth] = useState("");
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [managerLabel, setManagerLabel] = useState("");
  const [message, setMessage] = useState("正在加载首页摘要...");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function bootstrapPage() {
      try {
        const payload = await fetchQueryBootstrap();
        if (!mounted) {
          return;
        }
        const nextMonth = payload.account_sets.find((item) => item.is_active)?.month ?? payload.account_sets[0]?.month ?? "";
        setBootstrap(payload);
        setMonth(nextMonth);
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "查询首页初始化失败");
        setIsLoading(false);
      }
    }

    bootstrapPage();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!month) {
      return;
    }

    let mounted = true;

    async function loadSummary() {
      setIsLoading(true);
      try {
        const payload = await fetchHomeSummary(month);
        if (!mounted) {
          return;
        }
        setSummary(payload.summary ?? null);
        setManagerLabel(
          payload.manager ? `${payload.manager.emp_no} · ${payload.manager.name} · ${payload.manager.dept_name}` : "",
        );
        setMessage(payload.has_data ? payload.support_message ?? "已加载首页摘要" : payload.empty_state || "暂无数据");
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "加载首页摘要失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadSummary();
    return () => {
      mounted = false;
    };
  }, [month]);

  if (error && !bootstrap) {
    return <ErrorState description={error} title="查询首页初始化失败" />;
  }

  if (!bootstrap) {
    return <LoadingState message="正在准备查询首页..." />;
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <p style={tagStyle}>首页</p>
          <h2 style={titleStyle}>管理人员首页概览</h2>
          <p style={descriptionStyle}>围绕当前账号绑定的管理人员，展示本月考勤、福利假和调休余额概况。</p>
        </div>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>账套月份</span>
          <select onChange={(event) => setMonth(event.target.value)} style={selectStyle} value={month}>
            {bootstrap.account_sets.map((accountSet) => (
              <option key={accountSet.id} value={accountSet.month}>
                {accountSet.name}
                {accountSet.is_active ? "（当前）" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isLoading ? <LoadingState message="正在加载首页摘要..." /> : null}
      {error && !isLoading ? <ErrorState description={error} title="首页摘要加载失败" /> : null}

      {!isLoading && !error ? (
        <>
          <section style={managerCardStyle}>
            <p style={managerLabelStyle}>当前管理人员</p>
            <h3 style={managerTitleStyle}>{managerLabel || "未绑定管理人员"}</h3>
            <p style={managerBodyStyle}>{message}</p>
          </section>
          <section style={gridStyle}>
            {Object.entries(summary ?? {}).map(([key, value]) => (
              <article key={key} style={metricStyle}>
                <p style={metricLabelStyle}>{formatMetricLabel(key)}</p>
                <strong style={metricValueStyle}>{value ?? "-"}</strong>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </section>
  );
}

function formatMetricLabel(key: string): string {
  const labels: Record<string, string> = {
    attendance_days: "考勤天数",
    personal_sick_days: "事病假天数",
    injury_days: "工伤天数",
    business_trip_days: "出差天数",
    marriage_days: "婚假天数",
    funeral_days: "丧假天数",
    late_early_minutes: "迟到早退分钟",
    benefit_days: "剩余福利天数",
    overtime_remaining_days: "剩余调休天数",
  };
  return labels[key] ?? key;
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
};

const heroStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "24px",
  flexWrap: "wrap",
};

const tagStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: "10px 0 8px",
  fontSize: "34px",
  color: "#183153",
};

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: "#4b5d67",
  lineHeight: 1.7,
  maxWidth: "760px",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const fieldLabelStyle: CSSProperties = {
  fontWeight: 600,
  color: "#183153",
};

const selectStyle: CSSProperties = {
  borderRadius: "12px",
  border: "1px solid #d7dfd4",
  padding: "12px 14px",
  background: "#fffdfa",
};

const managerCardStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "linear-gradient(135deg, #183153 0%, #2c4f5f 100%)",
  color: "#f7f4ea",
};

const managerLabelStyle: CSSProperties = {
  margin: 0,
  color: "rgba(247, 244, 234, 0.7)",
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const managerTitleStyle: CSSProperties = {
  margin: "12px 0 10px",
  fontSize: "28px",
};

const managerBodyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  color: "rgba(247, 244, 234, 0.86)",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const metricStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "24px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};

const metricLabelStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
  fontSize: "14px",
};

const metricValueStyle: CSSProperties = {
  display: "block",
  marginTop: "12px",
  fontSize: "28px",
  color: "#183153",
};

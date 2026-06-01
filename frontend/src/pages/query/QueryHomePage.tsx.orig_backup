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

  const activeAccountSet = bootstrap.account_sets.find((accountSet) => accountSet.month === month) ?? null;
  const metrics = Object.entries(summary ?? {});

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">首页</p>
          <h2 className="legacy-page-title">管理人员首页概览</h2>
          <p className="legacy-page-description">围绕当前账号绑定的管理人员，查看本月考勤摘要、福利假与调休余额，并确认当前账套取数状态。</p>
        </div>
        <div className="query-home-header-tools">
          <label className="legacy-field legacy-header-field">
            <span className="legacy-field-label">账套月份</span>
            <select className="legacy-select" onChange={(event) => setMonth(event.target.value)} value={month}>
              {bootstrap.account_sets.map((accountSet) => (
                <option key={accountSet.id} value={accountSet.month}>
                  {accountSet.name}
                  {accountSet.is_active ? "（当前）" : ""}
                </option>
              ))}
            </select>
          </label>
          <dl className="legacy-page-side-info">
            <div className="legacy-page-side-item">
              <dt>当前账套</dt>
              <dd>{activeAccountSet?.name ?? "未选择"}</dd>
            </div>
            <div className="legacy-page-side-item">
              <dt>统计状态</dt>
              <dd>{isLoading ? "正在更新" : error ? "加载失败" : "已就绪"}</dd>
            </div>
          </dl>
        </div>
      </header>

      {isLoading ? <LoadingState message="正在加载首页摘要..." /> : null}
      {error && !isLoading ? <ErrorState description={error} title="首页摘要加载失败" /> : null}

      {!isLoading && !error ? (
        <div className="query-home-workspace">
          <section className="legacy-surface query-home-info-panel">
            <div className="query-home-panel-head">
              <div>
                <p className="query-home-panel-kicker">管理人员信息</p>
                <h3 className="query-home-panel-title">{managerLabel || "未绑定管理人员"}</h3>
              </div>
              <span className="query-home-status-tag">{activeAccountSet?.month || "未选择月份"}</span>
            </div>
            <div className="query-home-info-grid">
              <div className="query-home-info-item">
                <span className="query-home-info-label">取数账套</span>
                <strong>{activeAccountSet?.name ?? "未选择"}</strong>
              </div>
              <div className="query-home-info-item">
                <span className="query-home-info-label">统计范围</span>
                <strong>当前月度考勤与假勤余额</strong>
              </div>
            </div>
            <div className="query-home-message-box">
              <p className="query-home-message-title">首页说明</p>
              <p className="query-home-message-body">{message}</p>
            </div>
          </section>

          <section className="legacy-surface query-home-metrics-panel">
            <div className="query-home-panel-head">
              <div>
                <p className="query-home-panel-kicker">统计区</p>
                <h3 className="query-home-panel-title">本月摘要</h3>
              </div>
              <span className="query-home-panel-meta">{metrics.length} 项指标</span>
            </div>
            <div className="query-home-metrics-grid">
              {metrics.map(([key, value]) => (
                <article key={key} className="query-home-metric-card">
                  <p className="query-home-metric-label">{formatMetricLabel(key)}</p>
                  <strong className="query-home-metric-value">{value ?? "-"}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>
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

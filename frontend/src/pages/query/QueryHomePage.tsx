import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchHomeSummary, fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { QueryBootstrap } from "../../types/query";
import "./QueryHome.css";

export default function QueryHomePage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [month, setMonth] = useState("");
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [managerLabel, setManagerLabel] = useState("");
  const [managerInfo, setManagerInfo] = useState<{ emp_no: string; name: string; dept_name: string } | null>(null);
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
        setManagerInfo(payload.manager ?? null);
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

  // 假勤数据各百分比计算，用于占比条渲染
  const personalSick = Number(summary?.personal_sick_days ?? 0);
  const injury = Number(summary?.injury_days ?? 0);
  const trip = Number(summary?.business_trip_days ?? 0);
  const marriage = Number(summary?.marriage_days ?? 0);
  const funeral = Number(summary?.funeral_days ?? 0);
  const leaveTotal = personalSick + injury + trip + marriage + funeral;

  const sickPercent = leaveTotal > 0 ? (personalSick / leaveTotal) * 100 : 0;
  const injuryPercent = leaveTotal > 0 ? (injury / leaveTotal) * 100 : 0;
  const tripPercent = leaveTotal > 0 ? (trip / leaveTotal) * 100 : 0;
  const marriagePercent = leaveTotal > 0 ? (marriage / leaveTotal) * 100 : 0;
  const funeralPercent = leaveTotal > 0 ? (funeral / leaveTotal) * 100 : 0;

  return (
    <div className="query-home-container">
      {/* 仪表盘头部信息区 */}
      <header className="qh-dashboard-header">
        <div className="qh-header-title-area">
          <p className="qh-header-kicker">首页</p>
          <h2 className="qh-header-title">管理人员首页概览</h2>
        </div>
        <div className="qh-header-flat-controls">
          {/* 精致个人信息卡 */}
          <div className="qh-flat-profile">
            <div className="qh-avatar-badge">
              {managerInfo?.name ? managerInfo.name.charAt(0) : "管"}
            </div>
            <div className="qh-flat-meta">
              <h3 className="qh-flat-name">{managerInfo?.name || "未绑定管理人员"}</h3>
              <div className="qh-flat-sub">
                <span>工号: {managerInfo?.emp_no || "-"}</span>
                <span>所属部门: {managerInfo?.dept_name || "-"}</span>
              </div>
            </div>
            <span style={{ display: "none" }}>{managerLabel}</span>
          </div>

          {/* 账套月份选择器 */}
          <div className="qh-flat-select-wrapper">
            <span className="qh-flat-select-label">账套月份</span>
            <select className="qh-flat-select-input" onChange={(event) => setMonth(event.target.value)} value={month}>
              {bootstrap.account_sets.map((accountSet) => (
                <option key={accountSet.id} value={accountSet.month}>
                  {accountSet.name}
                  {accountSet.is_active ? "（当前）" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 数据就绪状态标签 */}
          <div className="qh-flat-status-badge">
            <span className={`qh-status-dot ${!isLoading && !error ? "active" : ""}`} />
            <span>
              {activeAccountSet?.name ?? "未选择"} · {isLoading ? "正在加载" : error ? "加载失败" : "已就绪"}
            </span>
          </div>
        </div>
      </header>

      {isLoading ? <LoadingState message="正在加载首页摘要..." /> : null}
      {error && !isLoading ? <ErrorState description={error} title="首页摘要加载失败" /> : null}

      {!isLoading && !error ? (
        <>
          {/* 四列大卡片核心 KPI 网格 */}
          <section className="qh-main-kpis-four">
            <div className="qh-kpi-card-hero attendance">
              <span className="qh-kpi-hero-label">考勤天数</span>
              <div className="qh-kpi-hero-body">
                <strong className="qh-kpi-hero-value">{summary?.attendance_days ?? 0}</strong>
                <span className="qh-kpi-hero-unit">天</span>
              </div>
            </div>
            <div className="qh-kpi-card-hero benefit">
              <span className="qh-kpi-hero-label">剩余福利天数</span>
              <div className="qh-kpi-hero-body">
                <strong className="qh-kpi-hero-value">{summary?.benefit_days ?? 0}</strong>
                <span className="qh-kpi-hero-unit">天</span>
              </div>
            </div>
            <div className="qh-kpi-card-hero overtime">
              <span className="qh-kpi-hero-label">剩余调休天数</span>
              <div className="qh-kpi-hero-body">
                <strong className="qh-kpi-hero-value">{summary?.overtime_remaining_days ?? 0}</strong>
                <span className="qh-kpi-hero-unit">天</span>
              </div>
            </div>
            <div className="qh-kpi-card-hero late-minutes">
              <span className="qh-kpi-hero-label">迟到早退分钟数</span>
              <div className="qh-kpi-hero-body">
                <strong className="qh-kpi-hero-value">{summary?.late_early_minutes ?? 0}</strong>
                <span className="qh-kpi-hero-unit">分钟</span>
              </div>
            </div>
          </section>

          {/* 自适应双栏 */}
          <div className="qh-layout-columns">
            {/* 左栏：详细指标面板按性质分类底色卡片 */}
            <section className="qh-dashboard-panel">
              <h3 className="qh-panel-title">详细考勤指标分析</h3>
              <div style={{ display: "grid", gap: "20px", marginTop: "16px" }}>
                {/* 类别1: 出勤指标 */}
                <div>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#475569", marginBottom: "8px", borderLeft: "3px solid #10b981", paddingLeft: "8px" }}>工作与出勤</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>考勤天数</div>
                      <strong style={{ fontSize: "20px", color: "#0f172a" }}>{summary?.attendance_days ?? 0} 天</strong>
                    </div>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>外勤出差天数</div>
                      <strong style={{ fontSize: "20px", color: "#0f172a" }}>{summary?.business_trip_days ?? 0} 天</strong>
                    </div>
                  </div>
                </div>

                {/* 类别2: 请假缺勤 */}
                <div>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#475569", marginBottom: "8px", borderLeft: "3px solid #f59e0b", paddingLeft: "8px" }}>缺勤与假勤</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fffbeb" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>事病假天数</div>
                      <strong style={{ fontSize: "20px", color: "#d97706" }}>{summary?.personal_sick_days ?? 0} 天</strong>
                    </div>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fffbeb" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>工伤天数</div>
                      <strong style={{ fontSize: "20px", color: "#d97706" }}>{summary?.injury_days ?? 0} 天</strong>
                    </div>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fffbeb" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>婚假天数</div>
                      <strong style={{ fontSize: "20px", color: "#d97706" }}>{summary?.marriage_days ?? 0} 天</strong>
                    </div>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fffbeb" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>丧假天数</div>
                      <strong style={{ fontSize: "20px", color: "#d97706" }}>{summary?.funeral_days ?? 0} 天</strong>
                    </div>
                  </div>
                </div>

                {/* 类别3: 额度余额 */}
                <div>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#475569", marginBottom: "8px", borderLeft: "3px solid #8b5cf6", paddingLeft: "8px" }}>额度与假勤余额</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f5f3ff" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>剩余福利天数</div>
                      <strong style={{ fontSize: "20px", color: "#7c3aed" }}>{summary?.benefit_days ?? 0} 天</strong>
                    </div>
                    <div style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f5f3ff" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>剩余调休天数</div>
                      <strong style={{ fontSize: "20px", color: "#7c3aed" }}>{summary?.overtime_remaining_days ?? 0} 天</strong>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 右栏：占比堆叠条和通知 Banner 说明 */}
            <div className="qh-right-box">
              {/* 请假假勤占比分析 */}
              <section className="qh-dashboard-panel">
                <h3 className="qh-panel-title">请假与外勤类型占比</h3>
                <div className="qh-stack-bar-box" style={{ marginTop: "16px" }}>
                  {leaveTotal > 0 ? (
                    <>
                      <div className="qh-stack-bar-wrapper">
                        {personalSick > 0 && <div className="qh-stack-segment sick" style={{ width: `${sickPercent}%` }} title={`事病假: ${personalSick}天`} />}
                        {injury > 0 && <div className="qh-stack-segment injury" style={{ width: `${injuryPercent}%` }} title={`工伤: ${injury}天`} />}
                        {trip > 0 && <div className="qh-stack-segment trip" style={{ width: `${tripPercent}%` }} title={`出差: ${trip}天`} />}
                        {marriage > 0 && <div className="qh-stack-segment marriage" style={{ width: `${marriagePercent}%` }} title={`婚假: ${marriage}天`} />}
                        {funeral > 0 && <div className="qh-stack-segment funeral" style={{ width: `${funeralPercent}%` }} title={`丧假: ${funeral}天`} />}
                      </div>
                      <div className="qh-stack-legend" style={{ marginTop: "12px" }}>
                        {personalSick > 0 && (
                          <div className="qh-legend-item">
                            <span className="qh-legend-dot sick" />
                            <span>事病假 ({personalSick}天)</span>
                          </div>
                        )}
                        {injury > 0 && (
                          <div className="qh-legend-item">
                            <span className="qh-legend-dot injury" />
                            <span>工伤 ({injury}天)</span>
                          </div>
                        )}
                        {trip > 0 && (
                          <div className="qh-legend-item">
                            <span className="qh-legend-dot trip" />
                            <span>出差 ({trip}天)</span>
                          </div>
                        )}
                        {marriage > 0 && (
                          <div className="qh-legend-item">
                            <span className="qh-legend-dot marriage" />
                            <span>婚假 ({marriage}天)</span>
                          </div>
                        )}
                        {funeral > 0 && (
                          <div className="qh-legend-item">
                            <span className="qh-legend-dot funeral" />
                            <span>丧假 ({funeral}天)</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="qh-stack-empty">本月暂无请假或出差记录</div>
                  )}
                </div>
              </section>

              {/* 首页说明 Notice Banner */}
              <div className="qh-notice-banner">
                <span className="qh-notice-icon">💡</span>
                <div className="qh-notice-content">
                  <h4 className="qh-notice-title">首页说明</h4>
                  <p className="qh-notice-body">{message}</p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

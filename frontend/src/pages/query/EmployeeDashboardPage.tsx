import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { buildDownloadUrl, fetchHeaderRows, fetchQueryBootstrap } from "../../api/query";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { QueryBootstrap } from "../../types/query";
import "./EmployeeDashboardPage.css";

export default function EmployeeDashboardPage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [showLeaveCounts, setShowLeaveCounts] = useState(false);
  const [showLeaveDurations, setShowLeaveDurations] = useState(false);
  const [tableHeaders, setTableHeaders] = useState<string[]>(["暂无数据"]);
  const [tableRows, setTableRows] = useState<Array<Array<string | number | null>>>([]);
  const [hasQueried, setHasQueried] = useState(false);

  // 进度条控制状态
  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [loadingText, setLoadingText] = useState("正在为您查询考勤数据...");

  // 驱动极光流光进度条的自动递增与冲刺淡出逻辑
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    let fadeTimer: ReturnType<typeof setTimeout>;
    let resetTimer: ReturnType<typeof setTimeout>;

    if (isQuerying) {
      setProgressVisible(true);
      setProgress(10);
      timer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(timer);
            return 90;
          }
          const step = (100 - prev) * 0.15;
          return Math.min(90, Math.round(prev + step));
        });
      }, 150);
    } else if (progressVisible) {
      setProgress(100);
      fadeTimer = setTimeout(() => {
        setProgressVisible(false);
        resetTimer = setTimeout(() => {
          setProgress(0);
        }, 300); // 确保淡出动画结束后清零
      }, 400);
    }

    return () => {
      clearInterval(timer);
      clearTimeout(fadeTimer);
      clearTimeout(resetTimer);
    };
  }, [isQuerying]);

  useEffect(() => {
    let mounted = true;

    async function bootstrapPage() {
      try {
        const payload = await fetchQueryBootstrap();
        if (!mounted) {
          return;
        }
        setBootstrap(payload);
        setSelectedMonth(payload.account_sets.find((accountSet) => accountSet.is_active)?.month ?? payload.account_sets[0]?.month ?? "");
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "员工考勤数据查询页初始化失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    bootstrapPage();
    return () => {
      mounted = false;
    };
  }, []);

  const queryTableEmptyText = hasQueried ? "暂无数据" : "请点击查询";

  function buildQuery() {
    const query = new URLSearchParams();
    if (selectedMonth) {
      query.set("month", selectedMonth);
    }
    selectedEmployeeIds.forEach((employeeId) => query.append("emp_ids", String(employeeId)));
    if (showLeaveCounts) {
      query.set("show_leave_counts", "1");
    }
    if (showLeaveDurations) {
      query.set("show_leave_durations", "1");
    }
    return query;
  }

  async function handleQuery() {
    setLoadingText("正在为您查询考勤数据...");
    setIsQuerying(true);
    setError("");

    try {
      const payload = await fetchHeaderRows("/api/query/employee-dashboard", buildQuery());
      setTableHeaders(payload.headers.length ? payload.headers : ["暂无数据"]);
      setTableRows(payload.rows);
      setHasQueried(true);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "查询失败，请稍后重试");
      setHasQueried(false);
      setTableHeaders(["暂无数据"]);
      setTableRows([]);
    } finally {
      setIsQuerying(false);
    }
  }

  function handleDownload() {
    setLoadingText("正在为您生成并下载报表...");
    setIsQuerying(true);
    window.location.href = buildDownloadUrl("/api/query/employee-dashboard/export", buildQuery());
    setTimeout(() => {
      setIsQuerying(false);
    }, 2000);
  }

  if (isLoading) {
    return <LoadingState message="正在准备员工考勤数据查询页..." />;
  }

  if (error && !bootstrap) {
    return <ErrorState description={error} title="员工考勤数据查询页初始化失败" />;
  }

  if (!bootstrap) {
    return <ErrorState description="未能读取员工考勤数据查询页基础数据。" />;
  }

  return (
    <div className="query-page-shell">
      {/* 极光背景流动球 */}
      <div className="qh-glow-sphere sphere-1" />
      <div className="qh-glow-sphere sphere-2" />
      <div className="qh-glow-sphere sphere-3" />

      <aside className="query-filter-rail">
        <div className="query-filter-heading">
          <span className="query-filter-kicker">Query Filters</span>
          <h2>查询条件</h2>
          <p>按员工范围、账套和显示列模式组合查询。</p>
        </div>

        <div className="query-filter-body">
          <div className="query-filter-field">
            <label className="form-label">员工</label>
            <EmployeePicker
              departments={bootstrap.departments}
              employees={bootstrap.employees}
              filterMode="employee"
              onChange={(ids) => {
                setSelectedEmployeeIds(ids);
                setHasQueried(false);
              }}
              showFieldChrome={false}
              selectedIds={selectedEmployeeIds}
            />
          </div>

          <div className="query-filter-field">
            <label className="form-label">账套</label>
            <select className="form-select" onChange={(event) => setSelectedMonth(event.target.value)} value={selectedMonth}>
              {bootstrap.account_sets.map((accountSet) => (
                <option key={accountSet.id} value={accountSet.month}>
                  {accountSet.name}
                  {accountSet.is_active ? "（当前）" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="query-filter-field">
            <label className="form-label">显示选项</label>
            <div className="dashboard-check-stack">
              <label className="dashboard-check-option">
                <input
                  checked={showLeaveCounts}
                  className="form-check-input m-0"
                  onChange={(event) => setShowLeaveCounts(event.target.checked)}
                  type="checkbox"
                />
                <span>请假次数</span>
              </label>
              <label className="dashboard-check-option">
                <input
                  checked={showLeaveDurations}
                  className="form-check-input m-0"
                  onChange={(event) => setShowLeaveDurations(event.target.checked)}
                  type="checkbox"
                />
                <span>请假时长</span>
              </label>
            </div>
          </div>

          <div className="query-filter-actions">
            <button className="btn btn-primary" disabled={isQuerying} onClick={handleQuery} type="button">
              {isQuerying ? "查询中..." : "查询"}
            </button>
            <button className="btn btn-outline-success" onClick={handleDownload} type="button">
              下载XLSX
            </button>
          </div>
        </div>

        {error ? <p className="legacy-inline-error">{error}</p> : null}
      </aside>

      <section className="query-workspace">
        {/* 全覆盖式极光磨砂玻璃加载遮罩 */}
        <div className={`query-workspace-loading ${progressVisible ? "is-active" : ""}`} role="status">
          <div className="query-loading-spinner-wrap">
            <div className="query-loading-spinner-ring" />
            <div className="query-loading-spinner-pulse" />
            <div className="query-loading-percent">{progress}%</div>
          </div>
          <div className="query-loading-text">{loadingText}</div>
        </div>
        <QueryResultPanel>
          <QueryTable emptyText={queryTableEmptyText} headers={tableHeaders} rows={tableRows} />
        </QueryResultPanel>
      </section>
    </div>
  );
}

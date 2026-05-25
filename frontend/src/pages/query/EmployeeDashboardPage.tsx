import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { buildDownloadUrl, fetchHeaderRows, fetchQueryBootstrap } from "../../api/query";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { QueryBootstrap } from "../../types/query";

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
    window.location.href = buildDownloadUrl("/api/query/employee-dashboard/export", buildQuery());
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
        <QueryResultPanel>
          <QueryTable emptyText={queryTableEmptyText} headers={tableHeaders} rows={tableRows} />
        </QueryResultPanel>
      </section>
    </div>
  );
}

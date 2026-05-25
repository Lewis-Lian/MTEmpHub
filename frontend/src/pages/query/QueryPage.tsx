import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { buildDownloadUrl, fetchHeaderRows, fetchObjectRows, fetchQueryBootstrap } from "../../api/query";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryTable from "../../components/query/QueryTable";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { AccountSet, QueryBootstrap } from "../../types/query";

type FieldType = "month" | "year" | "employees";
type PageKind = "headerRows" | "objectRows";

interface QueryOption {
  key: string;
  label: string;
  value: string;
}

interface QueryColumn {
  key: string;
  label: string;
  format?: (value: unknown, row: Record<string, unknown>) => string | number;
}

interface QueryPageProps {
  title: string;
  description: string;
  endpoint: string;
  exportPath?: string;
  templateExportPath?: string;
  kind: PageKind;
  fields: FieldType[];
  employeeFilterMode?: "all" | "manager" | "employee";
  options?: QueryOption[];
  columns?: QueryColumn[];
  prepareQuery?: (query: URLSearchParams, state: QueryState) => void;
}

interface QueryState {
  selectedEmployeeIds: number[];
  selectedMonth: string;
  selectedYear: string;
  selectedOptions: Record<string, boolean>;
}

export default function QueryPage({
  title,
  description,
  endpoint,
  exportPath,
  templateExportPath,
  kind,
  fields,
  employeeFilterMode = "all",
  options = [],
  columns = [],
  prepareQuery,
}: QueryPageProps) {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedOptions, setSelectedOptions] = useState<Record<string, boolean>>({});
  const [tableHeaders, setTableHeaders] = useState<string[]>([]);
  const [tableRows, setTableRows] = useState<Array<Array<string | number | null>>>([]);
  const [metaText, setMetaText] = useState("等待查询");

  useEffect(() => {
    let mounted = true;

    async function bootstrapPage() {
      try {
        const payload = await fetchQueryBootstrap();
        if (!mounted) {
          return;
        }
        setBootstrap(payload);
        if (fields.includes("month")) {
          setSelectedMonth(pickDefaultMonth(payload.account_sets));
        }
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "查询页初始化失败");
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

  function currentState(): QueryState {
    return {
      selectedEmployeeIds,
      selectedMonth,
      selectedYear,
      selectedOptions,
    };
  }

  function buildQueryFromState(state: QueryState): URLSearchParams {
    const query = new URLSearchParams();

    if (fields.includes("month") && state.selectedMonth) {
      query.set("month", state.selectedMonth);
    }
    if (fields.includes("year") && state.selectedYear) {
      query.set("year", state.selectedYear);
    }
    if (fields.includes("employees")) {
      state.selectedEmployeeIds.forEach((employeeId) => query.append("emp_ids", String(employeeId)));
    }

    options.forEach((option) => {
      if (state.selectedOptions[option.key]) {
        query.set(option.key, option.value);
      }
    });

    prepareQuery?.(query, state);
    return query;
  }

  async function handleQuery() {
    setIsQuerying(true);
    setMetaText("查询中...");
    setError("");

    try {
      const query = buildQueryFromState(currentState());
      if (kind === "headerRows") {
        const payload = await fetchHeaderRows(endpoint, query);
        setTableHeaders(Array.isArray(payload.headers) ? payload.headers : []);
        setTableRows(Array.isArray(payload.rows) ? payload.rows : []);
        setMetaText(payload.rows.length ? `共返回 ${payload.rows.length} 条记录` : "当前条件无数据");
      } else {
        const payload = await fetchObjectRows<Record<string, unknown>>(endpoint, query);
        setTableHeaders(columns.map((column) => column.label));
        setTableRows(
          payload.map((row) =>
            columns.map((column) => {
              const value = row[column.key];
              return column.format ? column.format(value, row) : stringifyCell(value);
            }),
          ),
        );
        setMetaText(payload.length ? `共返回 ${payload.length} 条记录` : "当前条件无数据");
      }
    } catch (caughtError) {
      const nextError = caughtError instanceof ApiError ? caughtError.message : "查询失败，请稍后重试";
      setError(nextError);
      setMetaText("查询失败");
    } finally {
      setIsQuerying(false);
    }
  }

  function handleDownload(path: string) {
    const query = buildQueryFromState(currentState());
    window.location.href = buildDownloadUrl(path, query);
  }

  if (isLoading) {
    return <LoadingState message="正在准备查询页..." />;
  }

  if (error && !bootstrap) {
    return <ErrorState description={error} title="查询页初始化失败" />;
  }

  if (!bootstrap) {
    return <ErrorState description="未能读取查询页基础数据。" />;
  }

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">查询中心</p>
          <h2 className="legacy-page-title">{title}</h2>
          <p className="legacy-page-description">{description}</p>
        </div>
        <dl className="legacy-page-side-info">
          {fields.includes("month") ? (
            <div className="legacy-page-side-item">
              <dt>当前账套</dt>
              <dd>{selectedMonth || "未选择"}</dd>
            </div>
          ) : null}
          {fields.includes("employees") ? (
            <div className="legacy-page-side-item">
              <dt>员工范围</dt>
              <dd>{selectedEmployeeIds.length ? `已选 ${selectedEmployeeIds.length} 人` : "全部"}</dd>
            </div>
          ) : null}
          <div className="legacy-page-side-item">
            <dt>结果状态</dt>
            <dd>{isQuerying ? "查询中" : metaText}</dd>
          </div>
        </dl>
      </header>

      <section className="legacy-surface legacy-form-surface">
        <div className="legacy-panel-heading">
          <div>
            <h3 className="legacy-query-panel-title">查询条件</h3>
            <p className="legacy-query-panel-description">请先设置筛选条件，再执行查询或导出。</p>
          </div>
        </div>
        <div className="legacy-form-grid">
          {fields.includes("month") ? (
            <label className="legacy-field">
              <span className="legacy-field-label">账套月份</span>
              <select className="legacy-select" onChange={(event) => setSelectedMonth(event.target.value)} value={selectedMonth}>
                {bootstrap.account_sets.map((accountSet) => (
                  <option key={accountSet.id} value={accountSet.month}>
                    {accountSet.name}
                    {accountSet.is_active ? "（当前）" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {fields.includes("year") ? (
            <label className="legacy-field">
              <span className="legacy-field-label">年份</span>
              <input
                className="legacy-input"
                onChange={(event) => setSelectedYear(event.target.value)}
                type="number"
                value={selectedYear}
              />
            </label>
          ) : null}

          {fields.includes("employees") ? (
            <EmployeePicker
              employees={bootstrap.employees}
              filterMode={employeeFilterMode}
              onChange={setSelectedEmployeeIds}
              selectedIds={selectedEmployeeIds}
            />
          ) : null}
        </div>

        {options.length ? (
          <div className="legacy-options-row">
            <span className="legacy-options-label">显示选项</span>
            {options.map((option) => (
              <label key={option.key} className="legacy-check-option">
                <input
                  checked={Boolean(selectedOptions[option.key])}
                  onChange={(event) => {
                    setSelectedOptions((current) => ({
                      ...current,
                      [option.key]: event.target.checked,
                    }));
                  }}
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="legacy-actions">
          <button className="legacy-btn-primary" disabled={isQuerying} onClick={handleQuery} type="button">
            {isQuerying ? "查询中..." : "查询"}
          </button>
          {exportPath ? (
            <button className="legacy-btn-secondary" onClick={() => handleDownload(exportPath)} type="button">
              下载结果
            </button>
          ) : null}
          {templateExportPath ? (
            <button className="legacy-btn-ghost" onClick={() => handleDownload(templateExportPath)} type="button">
              下载模板
            </button>
          ) : null}
        </div>
        {error ? <p className="legacy-inline-error">{error}</p> : null}
      </section>

      <section className="legacy-surface legacy-result-surface">
        <div className="legacy-result-head">
          <div>
            <h3 className="legacy-result-title">查询结果</h3>
            <p className="legacy-result-description">查询结果会按当前筛选条件在下方表格中展示。</p>
          </div>
          <span className="legacy-result-meta">{metaText}</span>
        </div>
        <QueryTable headers={tableHeaders} rows={tableRows} />
      </section>
    </section>
  );
}

function pickDefaultMonth(accountSets: AccountSet[]): string {
  return accountSets.find((accountSet) => accountSet.is_active)?.month ?? accountSets[0]?.month ?? "";
}

function stringifyCell(value: unknown): string | number {
  if (typeof value === "number") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.length ? JSON.stringify(value) : "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

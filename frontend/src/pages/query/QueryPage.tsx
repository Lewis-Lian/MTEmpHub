import type { CSSProperties } from "react";
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
        setSelectedMonth(pickDefaultMonth(payload.account_sets));
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
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <p style={tagStyle}>查询中心</p>
          <h2 style={titleStyle}>{title}</h2>
          <p style={descriptionStyle}>{description}</p>
        </div>
        <div style={statsStyle}>
          <span>账套：{selectedMonth || "未选择"}</span>
          {fields.includes("employees") ? <span>已选员工：{selectedEmployeeIds.length || "全部"}</span> : null}
          <span>状态：{isQuerying ? "查询中" : metaText}</span>
        </div>
      </header>

      <section style={panelStyle}>
        <div style={filtersGridStyle}>
          {fields.includes("month") ? (
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>账套月份</span>
              <select onChange={(event) => setSelectedMonth(event.target.value)} style={selectStyle} value={selectedMonth}>
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
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>年份</span>
              <input
                onChange={(event) => setSelectedYear(event.target.value)}
                style={selectStyle}
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
          <div style={optionsStyle}>
            {options.map((option) => (
              <label key={option.key} style={optionLabelStyle}>
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

        <div style={actionsStyle}>
          <button disabled={isQuerying} onClick={handleQuery} style={primaryButtonStyle} type="button">
            {isQuerying ? "查询中..." : "查询"}
          </button>
          {exportPath ? (
            <button onClick={() => handleDownload(exportPath)} style={secondaryButtonStyle} type="button">
              下载结果
            </button>
          ) : null}
          {templateExportPath ? (
            <button onClick={() => handleDownload(templateExportPath)} style={ghostButtonStyle} type="button">
              下载模板
            </button>
          ) : null}
        </div>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </section>

      <section style={panelStyle}>
        <div style={resultHeadStyle}>
          <h3 style={resultTitleStyle}>查询结果</h3>
          <span style={resultMetaStyle}>{metaText}</span>
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

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
};

const heroStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "24px",
  alignItems: "flex-start",
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
  maxWidth: "720px",
  color: "#4b5d67",
  lineHeight: 1.7,
};

const statsStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "18px 20px",
  borderRadius: "20px",
  background: "#f4efe4",
  color: "#31444c",
  minWidth: "220px",
};

const panelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
  display: "grid",
  gap: "20px",
};

const filtersGridStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
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

const optionsStyle: CSSProperties = {
  display: "flex",
  gap: "14px",
  flexWrap: "wrap",
};

const optionLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  color: "#31444c",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "12px",
  padding: "12px 18px",
  background: "#183153",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid #9bb39d",
  borderRadius: "12px",
  padding: "12px 18px",
  background: "#edf4ed",
  color: "#183153",
  cursor: "pointer",
  fontWeight: 600,
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid #d8dfdc",
  borderRadius: "12px",
  padding: "12px 18px",
  background: "#ffffff",
  color: "#31444c",
  cursor: "pointer",
  fontWeight: 600,
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b42318",
};

const resultHeadStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
};

const resultTitleStyle: CSSProperties = {
  margin: 0,
  color: "#183153",
  fontSize: "20px",
};

const resultMetaStyle: CSSProperties = {
  color: "#5c6f68",
  fontSize: "14px",
};

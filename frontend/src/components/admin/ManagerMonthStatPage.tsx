import { ChangeEvent, useEffect, useMemo, useState } from "react";

import { fetchAccountSets } from "../../api/admin";
import { apiRequest, buildApiUrl } from "../../api/client";
import { fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../feedback/ErrorState";
import LoadingState from "../feedback/LoadingState";
import EmployeePicker from "../query/EmployeePicker";
import QueryResultPanel from "../query/QueryResultPanel";
import type { QueryBootstrap } from "../../types/query";

interface MonthField {
  key: string;
  label: string;
}

interface SummaryColumn {
  key: string;
  label: string;
  render: (row: Record<string, unknown>) => string;
}

interface ManagerMonthStatPageProps {
  title: string;
  endpointBase: "/api/admin/manager-overtime" | "/api/admin/manager-annual-leave";
  listTitle: string;
  editTitle: string;
  remainingLabel: string;
  saveSuccessText: string;
  monthFields: MonthField[];
  summaryColumns: SummaryColumn[];
}

type ManagerStatRow = Record<string, unknown> & {
  emp_id: number;
  dept_name?: string;
  name?: string;
  remaining?: number | string | null;
  remark?: string;
};

type ColumnState = "editable" | "locked" | "missing_account_set";

export default function ManagerMonthStatPage({
  title,
  endpointBase,
  listTitle,
  editTitle,
  remainingLabel,
  saveSuccessText,
  monthFields,
  summaryColumns,
}: ManagerMonthStatPageProps) {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [rows, setRows] = useState<ManagerStatRow[]>([]);
  const [queryError, setQueryError] = useState("");
  const [resultMessage, setResultMessage] = useState("请选择年份和管理人员后查询");
  const [isQuerying, setIsQuerying] = useState(false);
  const [editingRow, setEditingRow] = useState<ManagerStatRow | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editRemark, setEditRemark] = useState("");
  const [columnStates, setColumnStates] = useState<Record<string, ColumnState>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const payload = await fetchQueryBootstrap();
        setBootstrap(payload);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "后台数据加载失败");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const managerEmployees = useMemo(
    () => bootstrap?.employees.filter((employee) => employee.is_manager) ?? [],
    [bootstrap],
  );

  async function loadRows() {
    if (!year) {
      setQueryError("请选择年份");
      return;
    }
    if (!selectedEmployeeIds.length) {
      setQueryError("请选择管理人员");
      return;
    }

    setIsQuerying(true);
    setQueryError("");

    try {
      const query = new URLSearchParams({ year, emp_ids: selectedEmployeeIds.join(",") });
      const [nextRows, states] = await Promise.all([
        apiRequest<ManagerStatRow[]>(`${endpointBase}/records?${query.toString()}`),
        buildColumnStates(year, monthFields.map((field) => field.key)),
      ]);
      setRows(Array.isArray(nextRows) ? nextRows : []);
      setColumnStates(states);
      setEditingRow(null);
      setResultMessage(Array.isArray(nextRows) && nextRows.length ? `已查询 ${nextRows.length} 人` : "当前条件无数据");
    } catch (error) {
      setRows([]);
      setResultMessage("查询失败");
      setQueryError(error instanceof Error ? error.message : "后台数据加载失败");
    } finally {
      setIsQuerying(false);
    }
  }

  function openEdit(row: ManagerStatRow) {
    setEditingRow(row);
    setEditValues(
      Object.fromEntries(monthFields.map((field) => [field.key, normalizeValue(row[field.key])])),
    );
    setEditRemark(String(row.remark ?? ""));
  }

  async function saveEdit() {
    if (!editingRow) {
      return;
    }

    const payload: Record<string, unknown> = {
      emp_id: editingRow.emp_id,
      year,
      remark: editRemark,
    };
    monthFields.forEach((field) => {
      payload[field.key] = editValues[field.key] ?? "";
    });

    try {
      await apiRequest(`${endpointBase}/records`, {
        body: payload,
        method: "PUT",
      });
      await loadRows();
      setResultMessage(saveSuccessText);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function submitImport() {
    setImportError("");
    if (!importFile?.name) {
      setImportError("请选择要导入的 xlsx 文件");
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
      setImportError("仅支持 .xlsx 文件");
      return;
    }

    const formData = new FormData();
    formData.append("year", year);
    formData.append("file", importFile);

    try {
      const result = await apiRequest<{
        imported?: number;
        warning?: string;
        error_count?: number;
        errors?: string[];
      }>(`${endpointBase}/import`, {
        body: formData,
        method: "POST",
      });
      const warnings = result.warning ? `\n${result.warning}` : "";
      const errors =
        result.error_count && result.errors?.length
          ? `\n失败 ${result.error_count} 条：\n${result.errors.join("\n")}`
          : "";
      setResultMessage(`已导入 ${String(result.imported ?? 0)} 人${warnings}${errors}`);
      setImportFile(null);
      if (selectedEmployeeIds.length) {
        await loadRows();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
    }
  }

  function handleExport() {
    if (!year) {
      setQueryError("请选择年份");
      return;
    }
    window.location.assign(buildApiUrl(`${endpointBase}/export?year=${encodeURIComponent(year)}`));
  }

  if (isLoading) {
    return <LoadingState message={`正在准备${title}页面...`} />;
  }

  if (loadError || !bootstrap) {
    return <ErrorState title={`${title}加载失败`} description={loadError || "后台数据加载失败"} />;
  }

  return (
    <div className="query-page-shell manager-month-stat-page">
      <aside className="query-filter-rail">
        <div className="query-filter-heading">
          <span className="query-filter-kicker">Query Filters</span>
          <h2>查询条件</h2>
          <p>按年度和人员筛选后查看列表，通过弹窗维护单人整年数据</p>
        </div>
        <div className="query-filter-body">
          <div className="query-filter-field">
            <label className="form-label">年份</label>
            <input
              className="form-control"
              max="2100"
              min="2000"
              onChange={(event) => setYear(event.target.value)}
              type="number"
              value={year}
            />
          </div>
          <div className="query-filter-field">
            <label className="form-label">人员筛选</label>
            <EmployeePicker
              departments={bootstrap.departments}
              employees={managerEmployees}
              filterMode="manager"
              label="管理人员范围"
              onChange={setSelectedEmployeeIds}
              selectedIds={selectedEmployeeIds}
              showFieldChrome={false}
            />
          </div>
          <div className="query-filter-field">
            <label className="form-label">导入文件</label>
            <div className="manager-month-stat-import-controls" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                accept=".xlsx"
                className="form-control"
                style={{ width: "160px" }}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <button className="btn btn-outline-warning" onClick={submitImport} type="button">
                导入
              </button>
              <a className="btn btn-outline-secondary" href={buildApiUrl(`${endpointBase}/template`)}>
                下载示例
              </a>
            </div>
          </div>
          <div className="query-filter-field">
            <label className="form-label">主要操作</label>
            <div className="query-filter-actions" style={{ display: "flex", gap: "8px" }}>
              <button className="btn btn-primary" onClick={loadRows} type="button">
                查询
              </button>
              <button className="btn btn-outline-success" onClick={handleExport} type="button">
                导出XLSX
              </button>
            </div>
            <div className="account-lock-notice" style={{ marginTop: "4px" }}>{buildLockNotice(year, columnStates)}</div>
          </div>
        </div>
        {queryError ? <div className="legacy-inline-error">{queryError}</div> : null}
        {importError ? <div className="legacy-inline-error">{importError}</div> : null}
        <div className="manager-month-stat-result" style={{ marginTop: "8px" }}>{resultMessage}</div>
      </aside>

      <section className="query-workspace">
        <QueryResultPanel>
          <div className="legacy-table-panel manager-month-stat-table-panel">
            <div className="legacy-table-wrap">
              <table className="legacy-table manager-month-stat-table">
                <thead>
                  <tr>
                    <th className="legacy-table-head-cell">部门</th>
                    <th className="legacy-table-head-cell">姓名</th>
                    {summaryColumns.map((column) => (
                      <th className="legacy-table-head-cell" key={column.key}>
                        {column.label}
                      </th>
                    ))}
                    <th className="legacy-table-head-cell">备注</th>
                    <th className="legacy-table-head-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => (
                      <tr key={row.emp_id}>
                        <td className="legacy-table-body-cell">{String(row.dept_name ?? "")}</td>
                        <td className="legacy-table-body-cell">{String(row.name ?? "")}</td>
                        {summaryColumns.map((column) => (
                          <td className="legacy-table-body-cell" key={column.key}>
                            {column.render(row)}
                          </td>
                        ))}
                        <td className="legacy-table-body-cell">{String(row.remark ?? "")}</td>
                        <td className="legacy-table-body-cell">
                          <button className="account-action-button" onClick={() => openEdit(row)} type="button">
                            编辑
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="legacy-table-empty-cell" colSpan={summaryColumns.length + 4}>
                        {isQuerying ? "正在加载..." : "当前条件无数据"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </QueryResultPanel>
      </section>

      {editingRow ? (
        <div className="master-modal-backdrop">
          <div className="master-modal manager-month-stat-edit-modal">
            <div className="master-modal-header">
              <div>
                <h2>{editTitle}</h2>
                <div className="attendance-override-edit-meta">
                  {String(editingRow.name ?? "")} / {year}
                </div>
              </div>
              <button aria-label="关闭" className="master-modal-close" onClick={() => setEditingRow(null)} type="button">
                ×
              </button>
            </div>
            <div className="master-modal-body">
              <div className="attendance-override-edit-table-wrap">
                <table className="legacy-table attendance-override-edit-table manager-month-stat-edit-table">
                  <thead>
                    <tr>
                      {monthFields.map((field) => (
                        <th className="legacy-table-head-cell" key={field.key}>
                          {field.label}
                        </th>
                      ))}
                      <th className="legacy-table-head-cell">{remainingLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {monthFields.map((field) => (
                        <td className="legacy-table-body-cell" key={field.key}>
                          <input
                            className="account-input attendance-override-edit-input"
                            disabled={columnStates[field.key] === "locked"}
                            onChange={(event) =>
                              setEditValues((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            value={editValues[field.key] ?? ""}
                          />
                        </td>
                      ))}
                      <td className="legacy-table-body-cell">{normalizeValue(editingRow.remaining)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <label className="account-field">
                <span className="account-field-label">备注</span>
                <textarea
                  className="account-input attendance-override-edit-remark"
                  onChange={(event) => setEditRemark(event.target.value)}
                  rows={3}
                  value={editRemark}
                />
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setEditingRow(null)} type="button">
                取消
              </button>
              <button className="account-action-button account-action-button--primary" onClick={saveEdit} type="button">
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

async function buildColumnStates(year: string, keys: string[]): Promise<Record<string, ColumnState>> {
  const accountSets = await fetchAccountSets();
  const nextStates: Record<string, ColumnState> = {};
  keys.forEach((key) => {
    const month = key === "prev_dec" ? `${Number(year) - 1}-12` : `${year}-${String(Number(key.slice(1))).padStart(2, "0")}`;
    const matched = accountSets.find((row) => row.month === month);
    if (!matched) {
      nextStates[key] = "missing_account_set";
      return;
    }
    nextStates[key] = matched.is_locked ? "locked" : "editable";
  });
  return nextStates;
}

function buildLockNotice(year: string, states: Record<string, ColumnState>): string {
  const locked: string[] = [];
  const missing: string[] = [];
  Object.entries(states).forEach(([key, state]) => {
    const month = key === "prev_dec" ? `${Number(year) - 1}-12` : `${year}-${String(Number(key.slice(1))).padStart(2, "0")}`;
    if (state === "locked") {
      locked.push(month);
    }
    if (state === "missing_account_set") {
      missing.push(month);
    }
  });
  const parts: string[] = [];
  if (locked.length) {
    parts.push(`已锁定：${locked.join("、")}`);
  }
  if (missing.length) {
    parts.push(`暂无账套：${missing.join("、")}（仍可编辑）`);
  }
  return parts.join("；") || "当前年度相关账套未锁定，可导入并通过弹窗保存";
}

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { apiRequest, buildApiUrl } from "../../api/client";
import { fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../feedback/ErrorState";
import LoadingState from "../feedback/LoadingState";
import EmployeePicker from "../query/EmployeePicker";
import QueryResultPanel from "../query/QueryResultPanel";
import QueryTable from "../query/QueryTable";
import type { AccountSet, QueryBootstrap } from "../../types/query";

interface OverrideEmployee {
  id: number;
  emp_no: string;
  name: string;
  dept_name?: string;
}

interface OverrideValues {
  remark?: string;
  updated_at?: string;
  updated_by_name?: string;
  [key: string]: unknown;
}

interface AttendanceOverrideRow {
  employee: OverrideEmployee;
  automatic: OverrideValues | null;
  override: OverrideValues | null;
  applied: OverrideValues | null;
}

interface AttendanceOverrideResponse {
  month: string;
  rows: AttendanceOverrideRow[];
}

interface FieldConfig {
  key: string;
  label: string;
  inputMode: "decimal" | "numeric";
}

interface AttendanceOverridesPageProps {
  title: string;
  pickerLabel: string;
  pickerButtonLabel: string;
  listEmptyHint: string;
  editTitle: string;
  editMetaEmpty: string;
  saveSuccessText: string;
  endpointBase: "/api/admin/employee-attendance-overrides" | "/api/admin/manager-attendance-overrides";
  filterMode: "employee" | "manager";
  fields: FieldConfig[];
}

interface EditDraftState {
  values: Record<string, string>;
  remark: string;
}

export default function AttendanceOverridesPage({
  title,
  pickerLabel,
  pickerButtonLabel,
  listEmptyHint,
  editTitle,
  editMetaEmpty,
  saveSuccessText,
  endpointBase,
  filterMode,
  fields,
}: AttendanceOverridesPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rows, setRows] = useState<AttendanceOverrideRow[]>([]);
  const [hasQueried, setHasQueried] = useState(false);
  const [editingRow, setEditingRow] = useState<AttendanceOverrideRow | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraftState>({ remark: "", values: {} });
  const [showActionsModal, setShowActionsModal] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadBootstrap() {
      try {
        const payload = await fetchQueryBootstrap();
        if (!mounted) {
          return;
        }
        setBootstrap(payload);
        setSelectedMonth(pickDefaultMonth(payload.account_sets));
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : "修正中心初始化失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const currentAccountSet = useMemo(
    () => bootstrap?.account_sets.find((accountSet) => accountSet.month === selectedMonth) ?? null,
    [bootstrap, selectedMonth],
  );
  const isLocked = Boolean(currentAccountSet?.is_locked);
  const lockNotice = isLocked
    ? `${selectedMonth || "-" } 账套已锁定，当前仅可查看列表和修正详情`
    : "";
  const tableHeaders = [
    "工号",
    "姓名",
    "部门",
    "系统值",
    "手工修正",
    "最终应用",
    "备注",
    "更新时间",
    { label: "操作", sortable: false as const },
  ];
  const tableRows = rows.map((row) => [
    row.employee.emp_no || "-",
    row.employee.name || "-",
    row.employee.dept_name || "-",
    summarizeValues(row.automatic, fields),
    summarizeValues(row.override, fields),
    summarizeValues(row.applied, fields),
    String(row.override?.remark ?? "-"),
    formatDateTime(row.override?.updated_at),
    (
      <button
        className="account-action-button"
        onClick={() => openEdit(row)}
        type="button"
      >
        编辑
      </button>
    ),
  ]);

  async function handleQuery() {
    if (!selectedMonth) {
      setError("请选择月份");
      return;
    }
    if (!selectedIds.length) {
      setError(`请选择${pickerLabel}`);
      return;
    }

    setIsQuerying(true);
    setError("");

    try {
      const query = new URLSearchParams({ month: selectedMonth });
      selectedIds.forEach((id) => query.append("emp_ids", String(id)));
      const payload = await apiRequest<AttendanceOverrideResponse>(`${endpointBase}?${query.toString()}`);
      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(nextRows);
      setHasQueried(true);
      setEditingRow(null);
    } catch (caughtError) {
      setRows([]);
      setHasQueried(true);
      setError(caughtError instanceof Error ? caughtError.message : "修正列表加载失败");
    } finally {
      setIsQuerying(false);
    }
  }

  function handleMonthChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedMonth(event.target.value);
    setEditingRow(null);
  }

  function handleSelectionChange(ids: number[]) {
    setSelectedIds(ids);
    setEditingRow(null);
  }

  function openEdit(row: AttendanceOverrideRow) {
    setEditingRow(row);
    setEditDraft({
      remark: String(row.override?.remark ?? ""),
      values: Object.fromEntries(fields.map((field) => [field.key, normalizeEditValue(row.override?.[field.key])])),
    });
  }

  function closeEdit() {
    setEditingRow(null);
  }

  function updateEditValue(key: string, value: string) {
    setEditDraft((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: value,
      },
    }));
  }

  async function saveEdit() {
    if (!editingRow || !selectedMonth) {
      return;
    }
    const payload: Record<string, unknown> = {
      month: selectedMonth,
      emp_id: editingRow.employee.id,
      remark: editDraft.remark,
    };
    fields.forEach((field) => {
      payload[field.key] = editDraft.values[field.key] ?? "";
    });

    try {
      const nextRow = await apiRequest<AttendanceOverrideRow>(`${endpointBase}/record`, {
        body: payload,
        method: "PUT",
      });
      setRows((currentRows) =>
        currentRows.map((row) => (row.employee.id === nextRow.employee.id ? nextRow : row)),
      );
      setEditingRow(nextRow);
      setEditDraft({
        remark: String(nextRow.override?.remark ?? ""),
        values: Object.fromEntries(fields.map((field) => [field.key, normalizeEditValue(nextRow.override?.[field.key])])),
      });
      window.alert(saveSuccessText);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "保存失败");
    }
  }

  function handleDownload(kind: "template" | "export") {
    if (!selectedMonth) {
      setError("请选择月份");
      return;
    }
    window.location.assign(buildApiUrl(`${endpointBase}/${kind}?month=${encodeURIComponent(selectedMonth)}`));
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!selectedMonth) {
      setError("请选择月份");
      event.target.value = "";
      return;
    }
    try {
      const form = new FormData();
      form.append("month", selectedMonth);
      form.append("file", file);
      const result = await apiRequest<{
        success_count: number;
        skipped_count: number;
        failed_count: number;
        changed_count: number;
        errors?: string[];
      }>(`${endpointBase}/import`, {
        body: form,
        method: "POST",
      });
      const summary = [
        `成功 ${result.success_count} 条`,
        `跳过 ${result.skipped_count} 条`,
        `失败 ${result.failed_count} 条`,
        `实际变更 ${result.changed_count} 条`,
      ];
      if (Array.isArray(result.errors) && result.errors.length) {
        summary.push("", result.errors.join("\n"));
      }
      window.alert(summary.join("\n"));
      if (selectedIds.length) {
        await handleQuery();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  if (isLoading) {
    return <LoadingState message={`正在准备${title}页面...`} />;
  }

  if (!bootstrap) {
    return <ErrorState description={error || `${title}初始化失败`} title={`${title}初始化失败`} />;
  }

  return (
    <div className="query-page-shell attendance-override-page">
      <aside className="query-filter-rail">
        <div className="query-filter-heading">
          <h2>查询条件</h2>
        </div>
        <div className="query-filter-body">
          <div className="query-filter-field">
            <label className="form-label">{pickerLabel}</label>
            <EmployeePicker
              departments={bootstrap.departments}
              employees={bootstrap.employees}
              filterMode={filterMode}
              label={pickerButtonLabel}
              onChange={handleSelectionChange}
              selectedIds={selectedIds}
              showFieldChrome={false}
            />
          </div>

          <div className="query-filter-field">
            <label className="form-label">月份</label>
            <input className="form-control" onChange={handleMonthChange} type="month" value={selectedMonth} />
          </div>

          <div className="query-filter-field">
            <label className="form-label">主要操作</label>
            <div className="query-filter-actions">
              <button className="btn btn-primary" disabled={isQuerying} onClick={handleQuery} type="button">
                {isQuerying ? "查询中..." : "查询"}
              </button>
              <button
                className="btn btn-outline-secondary"
                onClick={() => setShowActionsModal(true)}
                type="button"
              >
                导入导出
              </button>
              <input ref={fileInputRef} accept=".xlsx" className="attendance-override-file-input" style={{ display: "none" }} onChange={handleImportFile} type="file" />
            </div>
            {lockNotice ? (
              <div className={`account-lock-notice${isLocked ? " is-locked" : ""}`} style={{ marginTop: "4px" }}>{lockNotice}</div>
            ) : null}
          </div>
        </div>
        {error ? <div className="legacy-inline-error">{error}</div> : null}
      </aside>

      <section className="query-workspace">
        <QueryResultPanel>
          <QueryTable
            emptyText={hasQueried ? listEmptyHint : `请先查询${pickerLabel}和月份`}
            headers={tableHeaders}
            panelClassName="attendance-override-table-panel"
            rows={tableRows}
            tableClassName="attendance-override-table"
          />
        </QueryResultPanel>
      </section>

      {editingRow ? (
        <div aria-label={editTitle} aria-modal="true" className="master-modal-backdrop attendance-override-edit-backdrop" role="dialog">
          <div className="master-modal attendance-override-edit-modal">
            <div className="master-modal-header">
              <div>
                <h2>{editTitle}</h2>
                <div className="attendance-override-edit-meta">
                  {editingRow ? `${editingRow.employee.emp_no} - ${editingRow.employee.name} / ${selectedMonth || "-"}` : editMetaEmpty}
                </div>
              </div>
              <button aria-label="关闭" className="master-modal-close" onClick={closeEdit} type="button">
                ×
              </button>
            </div>
            <div className="master-modal-body">
              <div className="legacy-table-wrap attendance-override-edit-table-wrap">
                <table className="legacy-table attendance-override-edit-table">
                  <thead>
                    <tr>
                      <th className="legacy-table-head-cell"><div className="master-static-head">字段</div></th>
                      <th className="legacy-table-head-cell"><div className="master-static-head">系统自动值</div></th>
                      <th className="legacy-table-head-cell"><div className="master-static-head">手工修正</div></th>
                      <th className="legacy-table-head-cell"><div className="master-static-head">最终应用值</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.key}>
                        <td className="legacy-table-body-cell">{field.label}</td>
                        <td className="legacy-table-body-cell">{normalizeEditValue(editingRow.automatic?.[field.key]) || "-"}</td>
                        <td className="legacy-table-body-cell">
                          <input
                            className="account-input attendance-override-edit-input"
                            disabled={isLocked}
                            inputMode={field.inputMode}
                            onChange={(event) => updateEditValue(field.key, event.target.value)}
                            placeholder="自动"
                            value={editDraft.values[field.key] ?? ""}
                          />
                        </td>
                        <td className="legacy-table-body-cell">{normalizeEditValue(editingRow.applied?.[field.key]) || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="account-field">
                <span className="account-field-label">修正备注</span>
                <textarea
                  className="account-input attendance-override-edit-remark"
                  disabled={isLocked}
                  onChange={(event) => setEditDraft((current) => ({ ...current, remark: event.target.value }))}
                  placeholder="可填写修正原因"
                  rows={3}
                  value={editDraft.remark}
                />
              </label>
              <div className="account-lock-notice">{editingRow.override?.updated_at ? `最近保存 ${(editingRow.override.updated_by_name || "").trim()} ${formatDateTime(editingRow.override.updated_at)}`.trim() : "未保存"}</div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={closeEdit} type="button">
                取消
              </button>
              <button className="account-action-button account-action-button--primary" disabled={isLocked} onClick={saveEdit} type="button">
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showActionsModal ? (
        <div aria-label="导入导出" aria-modal="true" className="master-modal-backdrop attendance-override-actions-backdrop" role="dialog">
          <div className="master-modal attendance-override-actions-modal">
            <div className="master-modal-header">
              <div>
                <h2>导入导出</h2>
                <div className="attendance-override-edit-meta">选择需要执行的数据导出或导入操作</div>
              </div>
              <button aria-label="关闭" className="master-modal-close" onClick={() => setShowActionsModal(false)} type="button">
                ×
              </button>
            </div>
            <div className="master-modal-body attendance-override-actions-body">
              <button
                className="account-action-button account-action-button--primary attendance-override-actions-button"
                onClick={() => { handleDownload("export"); setShowActionsModal(false); }}
                type="button"
              >
                导出
              </button>
              <button
                className="account-action-button account-action-button--success attendance-override-actions-button"
                disabled={isLocked}
                onClick={() => { fileInputRef.current?.click(); setShowActionsModal(false); }}
                type="button"
              >
                导入
              </button>
              <button
                className="account-action-button attendance-override-actions-button"
                onClick={() => { handleDownload("template"); setShowActionsModal(false); }}
                type="button"
              >
                示例下载
              </button>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setShowActionsModal(false)} type="button">
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function pickDefaultMonth(accountSets: AccountSet[]): string {
  return accountSets.find((accountSet) => accountSet.is_active)?.month ?? accountSets[0]?.month ?? "";
}

function normalizeEditValue(value: unknown): string {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function summarizeValues(values: OverrideValues | null, fields: FieldConfig[]): string {
  if (!values) {
    return "-";
  }
  const parts = fields
    .map((field) => {
      const value = values[field.key];
      if (value === null || value === undefined || value === "") {
        return null;
      }
      return `${field.label}：${String(value)}`;
    })
    .filter((item): item is string => Boolean(item));
  return parts.join("；") || "-";
}

function formatDateTime(value: unknown): string {
  return typeof value === "string" && value ? value.replace("T", " ").slice(0, 19) : "-";
}

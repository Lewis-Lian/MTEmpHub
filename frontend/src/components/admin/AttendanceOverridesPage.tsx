import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "../../api/client";
import { useNotification } from "../feedback/Notification";
import { fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../feedback/ErrorState";
import LoadingState from "../feedback/LoadingState";
import QueryProgressOverlay from "../feedback/QueryProgressOverlay";
import EmployeePicker from "../query/EmployeePicker";
import QueryResultPanel from "../query/QueryResultPanel";
import QueryTable from "../query/QueryTable";
import type { AccountSet, QueryBootstrap } from "../../types/query";
import MonthPicker from "../common/MonthPicker";
import AttendanceOverrideCalendarModal from "./AttendanceOverrideCalendarModal";

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

interface DailyOverrideSummary {
  corrected_days: number;
  status_counts: Record<string, number>;
  updated_at?: string;
  updated_by_name?: string;
  remark?: string;
}

interface AttendanceOverrideRow {
  employee: OverrideEmployee;
  automatic: OverrideValues | null;
  override: OverrideValues | null;
  applied: OverrideValues | null;
  daily?: DailyOverrideSummary | null;
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
  endpointBase: "/api/admin/employee-attendance-overrides" | "/api/admin/manager-attendance-overrides";
  filterMode: "employee" | "manager";
  fields: FieldConfig[];
}

export default function AttendanceOverridesPage({
  title,
  pickerLabel,
  pickerButtonLabel,
  listEmptyHint,
  editTitle,
  endpointBase,
  filterMode,
  fields,
}: AttendanceOverridesPageProps) {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const notification = useNotification();
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rows, setRows] = useState<AttendanceOverrideRow[]>([]);
  const [hasQueried, setHasQueried] = useState(false);
  const [editingRow, setEditingRow] = useState<AttendanceOverrideRow | null>(null);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("");

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
        notification.error(caughtError instanceof Error ? caughtError.message : "修正中心初始化失败");
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
  }, [notification]);

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
    summarizeCorrections(row, fields),
    summarizeValues(row.applied, fields),
    latestRemark(row),
    latestUpdateCell(row),
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
      notification.error("请选择月份");
      return;
    }

    setIsQuerying(true);
    setProgressVisible(true);
    setProgress(0);
    setLoadingText("正在查询考勤数据...");
    let current = 0;
    const interval = setInterval(() => {
      current += Math.floor(Math.random() * 20) + 10;
      if (current >= 95) current = 95;
      setProgress(current);
    }, 80);

    try {
      const query = new URLSearchParams({ month: selectedMonth });
      selectedIds.forEach((id) => query.append("emp_ids", String(id)));
      const payload = await apiRequest<AttendanceOverrideResponse>(`${endpointBase}?${query.toString()}`);
      
      clearInterval(interval);
      setProgress(100);
      setLoadingText("查询完成");
      await new Promise((resolve) => setTimeout(resolve, 300));

      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(nextRows);
      setHasQueried(true);
      setEditingRow(null);
    } catch (caughtError) {
      clearInterval(interval);
      setRows([]);
      setHasQueried(true);
      notification.error(caughtError instanceof Error ? caughtError.message : "修正列表加载失败");
    } finally {
      setTimeout(() => setProgressVisible(false), 300);
      setIsQuerying(false);
    }
  }

  function handleMonthChange(val: string) {
    setSelectedMonth(val);
    setEditingRow(null);
  }

  function handleSelectionChange(ids: number[]) {
    setSelectedIds(ids);
    setEditingRow(null);
  }

  function openEdit(row: AttendanceOverrideRow) {
    setEditingRow(row);
  }

  function handleRowRefresh(nextRow: unknown) {
    const typedRow = nextRow as AttendanceOverrideRow;
    setRows((currentRows) =>
      currentRows.map((row) => (row.employee.id === typedRow.employee.id ? typedRow : row)),
    );
    setEditingRow((current) => (current && current.employee.id === typedRow.employee.id ? typedRow : current));
  }

  if (isLoading) {
    return <LoadingState filterFields={3} headers={tableHeaders.map((header) => typeof header === "string" ? header : typeof header.label === "string" ? header.label : "")} message={`正在准备${title}页面...`} variant="query-page" />;
  }

  if (!bootstrap) {
    return <ErrorState description={`${title}初始化失败`} title={`${title}初始化失败`} />;
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
            <MonthPicker onChange={handleMonthChange} value={selectedMonth} />
          </div>

          <div className="query-filter-field">
            <label className="form-label">主要操作</label>
            <div className="query-filter-actions">
              <button className="btn btn-primary" disabled={isQuerying} onClick={handleQuery} type="button">
                {isQuerying ? "查询中..." : "查询"}
              </button>
            </div>
            {lockNotice ? (
              <div className={`account-lock-notice${isLocked ? " is-locked" : ""}`} style={{ marginTop: "4px" }}>{lockNotice}</div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="query-workspace">
        <QueryProgressOverlay active={progressVisible} progress={progress} text={loadingText} />
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
        <AttendanceOverrideCalendarModal
          editTitle={editTitle}
          employee={editingRow.employee}
          hasMonthlyOverride={Boolean(editingRow.override?.updated_at)}
          isLocked={isLocked}
          isManager={filterMode === "manager"}
          month={selectedMonth}
          onClose={() => setEditingRow(null)}
          onRowRefresh={handleRowRefresh}
        />
      ) : null}
    </div>
  );
}

function pickDefaultMonth(accountSets: AccountSet[]): string {
  return accountSets.find((accountSet) => accountSet.is_active)?.month ?? accountSets[0]?.month ?? "";
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

// 手工修正列：逐日修正汇总 + 历史月度修正（只读），无修正时显示 "-"
function summarizeCorrections(row: AttendanceOverrideRow, fields: FieldConfig[]): string {
  const parts: string[] = [];
  const daily = row.daily;
  if (daily && daily.corrected_days > 0) {
    const statusText = Object.entries(daily.status_counts ?? {})
      .map(([status, count]) => `${status}×${count}`)
      .join("、");
    parts.push(
      statusText ? `逐日修正 ${daily.corrected_days} 天（${statusText}）` : `逐日修正 ${daily.corrected_days} 天`,
    );
  }
  const monthly = row.override ? summarizeValues(row.override, fields) : "-";
  if (monthly !== "-") {
    parts.push(`月度修正（历史）：${monthly}`);
  }
  return parts.join("；") || "-";
}

// 备注列：优先最近一次逐日修正的备注，否则历史月度修正备注
function latestRemark(row: AttendanceOverrideRow): string {
  const dailyRemark = (row.daily?.remark ?? "").trim();
  if (dailyRemark) {
    return dailyRemark;
  }
  const monthlyRemark = String(row.override?.remark ?? "").trim();
  return monthlyRemark || "-";
}

// 更新时间列：取逐日/月度两层中最近的一次，附操作人
function latestUpdateCell(row: AttendanceOverrideRow): string {
  const candidates = [
    { at: row.daily?.updated_at ?? "", by: (row.daily?.updated_by_name ?? "").trim() },
    { at: row.override?.updated_at ?? "", by: String(row.override?.updated_by_name ?? "").trim() },
  ].filter((candidate) => candidate.at);
  if (!candidates.length) {
    return "-";
  }
  const latest = candidates.reduce((left, right) => (left.at > right.at ? left : right));
  const time = formatDateTime(latest.at);
  return latest.by ? `${time}（${latest.by}）` : time;
}

function formatDateTime(value: unknown): string {
  return typeof value === "string" && value ? value.replace("T", " ").slice(0, 19) : "-";
}

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "../../api/client";
import { fetchQueryBootstrap } from "../../api/query";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryTable from "../../components/query/QueryTable";
import type { QueryBootstrap } from "../../types/query";

interface ManagerAttendanceOverrideRow {
  employee: {
    id: number;
    emp_no: string;
    name: string;
    dept_name: string;
  };
  automatic: Record<string, unknown> | null;
  override: {
    remark?: string;
    updated_at?: string;
    [key: string]: unknown;
  } | null;
  applied: Record<string, unknown> | null;
}

interface ManagerAttendanceOverrideListResponse {
  month: string;
  rows: ManagerAttendanceOverrideRow[];
}

const SUMMARY_FIELDS: Array<[key: string, label: string]> = [
  ["attendance_days", "出勤天数"],
  ["injury_days", "工伤"],
  ["business_trip_days", "出差"],
  ["marriage_days", "婚假"],
  ["funeral_days", "丧假"],
  ["late_early_minutes", "迟到早退"],
];

export default function ManagerAttendanceOverridesPage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [rows, setRows] = useState<ManagerAttendanceOverrideRow[]>([]);
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
        setSelectedMonth(pickDefaultMonth(payload));
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "页面初始化失败");
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

  async function handleQuery() {
    if (!selectedMonth) {
      setError("请选择账套月份");
      setMetaText("等待查询");
      return;
    }
    if (!selectedEmployeeIds.length) {
      setError("请选择至少一名管理人员");
      setMetaText("等待查询");
      return;
    }

    setIsQuerying(true);
    setError("");
    setMetaText("查询中...");

    try {
      const query = new URLSearchParams({ month: selectedMonth });
      selectedEmployeeIds.forEach((employeeId) => {
        query.append("emp_ids", String(employeeId));
      });
      const payload = await apiRequest<ManagerAttendanceOverrideListResponse>(
        `/api/admin/manager-attendance-overrides?${query.toString()}`,
      );
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setMetaText(payload.rows.length ? `共返回 ${payload.rows.length} 条记录` : "当前条件无数据");
    } catch (caughtError) {
      setRows([]);
      setError(caughtError instanceof ApiError ? caughtError.message : "管理人员考勤修正加载失败");
      setMetaText("查询失败");
    } finally {
      setIsQuerying(false);
    }
  }

  if (isLoading) {
    return <LoadingState message="正在准备管理人员考勤修正页面..." />;
  }

  if (error && !bootstrap) {
    return <ErrorState description={error} title="管理人员考勤修正初始化失败" />;
  }

  if (!bootstrap) {
    return <ErrorState description="未能读取管理人员修正基础数据。" />;
  }

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">后台管理</p>
          <h2 className="legacy-page-title">管理人员考勤修正</h2>
          <p className="legacy-page-description">按月份和管理人员范围查询当前修正结果，便于继续核对系统值、手工修正值和最终应用值。</p>
        </div>
        <dl className="legacy-page-side-info">
          <div className="legacy-page-side-item">
            <dt>修正月份</dt>
            <dd>{selectedMonth || "未选择"}</dd>
          </div>
          <div className="legacy-page-side-item">
            <dt>管理人员</dt>
            <dd>{selectedEmployeeIds.length ? `已选 ${selectedEmployeeIds.length} 人` : "未选择"}</dd>
          </div>
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
            <p className="legacy-query-panel-description">请选择账套月份和管理人员后执行查询。当前页面仅恢复列表查询，不包含旧版逐行编辑弹窗。</p>
          </div>
        </div>
        <div className="legacy-form-grid">
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

          <EmployeePicker
            employees={bootstrap.employees}
            filterMode="manager"
            label="管理人员范围"
            onChange={setSelectedEmployeeIds}
            selectedIds={selectedEmployeeIds}
          />
        </div>

        <div className="legacy-actions">
          <button className="legacy-btn-primary" disabled={isQuerying} onClick={handleQuery} type="button">
            {isQuerying ? "查询中..." : "查询"}
          </button>
        </div>
        {error ? <p className="legacy-inline-error">{error}</p> : null}
      </section>

      <section className="legacy-surface legacy-result-surface">
        <div className="legacy-result-head">
          <div>
            <h3 className="legacy-result-title">修正列表</h3>
            <p className="legacy-result-description">下方展示系统值、手工修正值和最终应用值的对照结果。</p>
          </div>
          <span className="legacy-result-meta">{metaText}</span>
        </div>
        <QueryTable
          headers={["工号", "姓名", "部门", "系统值", "手工修正", "最终应用", "备注", "更新时间"]}
          rows={rows.map((row) => [
            row.employee.emp_no || "",
            row.employee.name || "",
            row.employee.dept_name || "",
            summarizeValues(row.automatic),
            summarizeValues(row.override),
            summarizeValues(row.applied),
            row.override?.remark || "-",
            formatDateTime(row.override?.updated_at),
          ])}
        />
      </section>
    </section>
  );
}

function pickDefaultMonth(bootstrap: QueryBootstrap): string {
  return bootstrap.account_sets.find((accountSet) => accountSet.is_active)?.month ?? bootstrap.account_sets[0]?.month ?? "";
}

function summarizeValues(values: Record<string, unknown> | null | undefined): string {
  if (!values) {
    return "-";
  }
  const parts = SUMMARY_FIELDS.map(([key, label]) => {
    const value = values[key];
    if (value === null || value === undefined || value === "") {
      return null;
    }
    return `${label}：${String(value)}`;
  }).filter((item): item is string => Boolean(item));

  return parts.join("；") || "-";
}

function formatDateTime(value: string | undefined): string {
  return value ? value.replace("T", " ").slice(0, 19) : "-";
}

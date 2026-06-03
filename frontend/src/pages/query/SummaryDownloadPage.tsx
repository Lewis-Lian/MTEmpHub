import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { buildDownloadUrl, fetchQueryBootstrap } from "../../api/query";
import EmployeePicker from "../../components/query/EmployeePicker";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { QueryBootstrap } from "../../types/query";

const FINAL_HEADERS = [
  "部门名称",
  "人员编号",
  "人员姓名",
  "考勤天数",
  "病假（次数）",
  "工伤（次数）",
  "丧假（次数）",
  "事假（次数）",
  "补休（调休）(次)",
  "婚假（次）",
  "病假时长（天）",
  "工伤时长（天）",
  "丧假时长（天）",
  "事假时长（天）",
  "补休（调休）(天)",
  "婚假（天）",
  "工时",
  "半勤天数",
  "备注",
];

const PUNCH_HEADERS = [
  "日期",
  "员工编号",
  "员工姓名",
  "部门",
  "原始打卡数据",
  "上班打卡",
  "下班打卡",
  "打卡次数",
  "实出勤小时",
  "迟到分钟",
  "早退分钟",
  "异常原因",
];

const ABNORMAL_HEADERS = ["部门名称", "人员编号", "人员姓名", "异常考勤次数"];

const EMP_DEPT_HOURS_HEADERS = ["部门名称", "总工时（小时）", "部门人数"];

const MGR_ATTENDANCE_HEADERS = [
  "部   门",
  "姓名",
  "出勤天数",
  "实际出勤天数",
  "事/病假",
  "工伤",
  "出差",
  "婚假",
  "丧假",
  "迟到\\早退",
  "汇总",
  "福利天数",
  "加班变化",
  "备注",
];

const MGR_OVERTIME_HEADERS = [
  "部门",
  "姓名",
  "前年累积天数",
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
  "剩余调休天数",
  "备注",
];

const MGR_ANNUAL_LEAVE_HEADERS = [
  "部门",
  "姓名",
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
  "剩余年休天数",
  "备注",
];

const MGR_DEPT_HOURS_HEADERS = ["部门名称", "总工时（小时）", "部门人数"];

export default function SummaryDownloadPage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);

  // 8张表勾选状态
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includePunch, setIncludePunch] = useState(true);
  const [includeAbnormal, setIncludeAbnormal] = useState(false);
  const [includeEmpDeptHours, setIncludeEmpDeptHours] = useState(false);
  const [includeMgrAttendance, setIncludeMgrAttendance] = useState(false);
  const [includeMgrOvertime, setIncludeMgrOvertime] = useState(false);
  const [includeMgrAnnualLeave, setIncludeMgrAnnualLeave] = useState(false);
  const [includeMgrDeptHours, setIncludeMgrDeptHours] = useState(false);

  // 8张表表头过滤配置状态
  const [finalHeaders, setFinalHeaders] = useState<string[]>(FINAL_HEADERS);
  const [punchHeaders, setPunchHeaders] = useState<string[]>(PUNCH_HEADERS);
  const [abnormalHeaders, setAbnormalHeaders] = useState<string[]>(ABNORMAL_HEADERS);
  const [empDeptHoursHeaders, setEmpDeptHoursHeaders] = useState<string[]>(EMP_DEPT_HOURS_HEADERS);
  const [mgrAttendanceHeaders, setMgrAttendanceHeaders] = useState<string[]>(MGR_ATTENDANCE_HEADERS);
  const [mgrOvertimeHeaders, setMgrOvertimeHeaders] = useState<string[]>(MGR_OVERTIME_HEADERS);
  const [mgrAnnualLeaveHeaders, setMgrAnnualLeaveHeaders] = useState<string[]>(MGR_ANNUAL_LEAVE_HEADERS);
  const [mgrDeptHoursHeaders, setMgrDeptHoursHeaders] = useState<string[]>(MGR_DEPT_HOURS_HEADERS);

  useEffect(() => {
    let mounted = true;

    async function bootstrapPage() {
      try {
        const payload = await fetchQueryBootstrap();
        if (!mounted) {
          return;
        }
        setBootstrap(payload);
        setSelectedMonth(payload.account_sets.find((item) => item.is_active)?.month ?? payload.account_sets[0]?.month ?? "");
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "汇总下载页初始化失败");
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

  const applyPreset1 = () => {
    // 预设1：员工考勤汇总
    setIncludeFinal(true);
    setIncludePunch(true);
    setIncludeAbnormal(false);
    setIncludeEmpDeptHours(false);
    setIncludeMgrAttendance(false);
    setIncludeMgrOvertime(false);
    setIncludeMgrAnnualLeave(false);
    setIncludeMgrDeptHours(false);

    setFinalHeaders(FINAL_HEADERS);
    setPunchHeaders(PUNCH_HEADERS.filter((h) => h !== "上班打卡" && h !== "下班打卡"));
  };

  const applyPreset2 = () => {
    // 预设2：工时汇总
    setIncludeFinal(false);
    setIncludePunch(false);
    setIncludeAbnormal(false);
    setIncludeEmpDeptHours(true);
    setIncludeMgrAttendance(false);
    setIncludeMgrOvertime(false);
    setIncludeMgrAnnualLeave(false);
    setIncludeMgrDeptHours(true);

    setEmpDeptHoursHeaders(EMP_DEPT_HOURS_HEADERS);
    setMgrDeptHoursHeaders(MGR_DEPT_HOURS_HEADERS);
  };

  function toggleAllHeaders(headers: string[], selectedHeaders: string[], setSelectedHeaders: (headers: string[]) => void) {
    setSelectedHeaders(selectedHeaders.length === headers.length ? [] : headers);
  }

  function toggleHeader(header: string, selectedHeaders: string[], setSelectedHeaders: (headers: string[]) => void) {
    setSelectedHeaders(
      selectedHeaders.includes(header)
        ? selectedHeaders.filter((item) => item !== header)
        : [...selectedHeaders, header],
    );
  }

  function handleDownload() {
    const selectedSheets = [
      includeFinal ? "final" : "",
      includePunch ? "punch" : "",
      includeAbnormal ? "abnormal" : "",
      includeEmpDeptHours ? "emp_dept_hours" : "",
      includeMgrAttendance ? "mgr_attendance" : "",
      includeMgrOvertime ? "mgr_overtime" : "",
      includeMgrAnnualLeave ? "mgr_annual_leave" : "",
      includeMgrDeptHours ? "mgr_dept_hours" : "",
    ].filter(Boolean);

    if (selectedSheets.length === 0) {
      setError("请至少选择一个要导出的表格。");
      return;
    }
    setError("");

    const query = new URLSearchParams();
    if (selectedMonth) {
      query.set("month", selectedMonth);
    }
    selectedEmployeeIds.forEach((employeeId) => query.append("emp_ids", String(employeeId)));
    query.set("sheets", selectedSheets.join(","));

    if (includeFinal) query.set("final_headers", finalHeaders.join(","));
    if (includePunch) query.set("punch_headers", punchHeaders.join(","));
    if (includeAbnormal) query.set("abnormal_headers", abnormalHeaders.join(","));
    if (includeEmpDeptHours) query.set("emp_dept_hours_headers", empDeptHoursHeaders.join(","));
    if (includeMgrAttendance) query.set("mgr_attendance_headers", mgrAttendanceHeaders.join(","));
    if (includeMgrOvertime) query.set("mgr_overtime_headers", mgrOvertimeHeaders.join(","));
    if (includeMgrAnnualLeave) query.set("mgr_annual_leave_headers", mgrAnnualLeaveHeaders.join(","));
    if (includeMgrDeptHours) query.set("mgr_dept_hours_headers", mgrDeptHoursHeaders.join(","));

    window.location.href = buildDownloadUrl("/api/query/summary-download/export", query);
  }

  if (isLoading) {
    return <LoadingState message="正在准备汇总下载页..." />;
  }

  if (error && !bootstrap) {
    return <ErrorState description={error} title="汇总下载页初始化失败" />;
  }

  if (!bootstrap) {
    return <ErrorState description="未能读取汇总下载页基础数据。" />;
  }

  const activeAccountSet = bootstrap.account_sets.find((accountSet) => accountSet.month === selectedMonth) ?? null;
  const selectedEmployeeCount = selectedEmployeeIds.length;
  const enabledReportsCount = [
    includeFinal,
    includePunch,
    includeAbnormal,
    includeEmpDeptHours,
    includeMgrAttendance,
    includeMgrOvertime,
    includeMgrAnnualLeave,
    includeMgrDeptHours,
  ].filter(Boolean).length;

  const downloadStatus =
    enabledReportsCount === 0
      ? "未选择报表"
      : selectedMonth
        ? `已选 ${enabledReportsCount} 份报表，等待下载`
        : "请先选择账套月份";

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">查询中心</p>
          <h2 className="legacy-page-title">汇总下载</h2>
          <p className="legacy-page-description">选择账套、员工范围和下载内容，下载合并后的月度汇总工作簿。</p>
        </div>
        <dl className="legacy-page-side-info">
          <div className="legacy-page-side-item">
            <dt>当前账套</dt>
            <dd>{activeAccountSet?.name ?? "未选择"}</dd>
          </div>
          <div className="legacy-page-side-item">
            <dt>已选员工</dt>
            <dd>{selectedEmployeeCount === 0 ? "全部员工" : `${selectedEmployeeCount} 人`}</dd>
          </div>
        </dl>
      </header>

      {/* 预设使用情景选择区 */}
      <section className="legacy-surface" style={{ padding: "20px", marginBottom: "20px" }}>
        <div className="legacy-panel-heading" style={{ marginBottom: "16px" }}>
          <h3 className="legacy-query-panel-title">使用情景预设</h3>
          <p className="legacy-query-panel-description">根据常见导出业务一键配置所需表格和表头过滤选项。</p>
        </div>
        <div className="preset-scenarios-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <button
            onClick={applyPreset1}
            style={{
              border: "1px solid var(--ent-border-strong, #cbd5e1)",
              borderRadius: "12px",
              padding: "16px",
              background: "#f8fafc",
              textAlign: "left",
              cursor: "pointer",
              transition: "transform 0.2s, box-shadow 0.2s",
              display: "block",
            }}
            type="button"
            className="preset-btn-hover"
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "20px" }}>🌟</span>
              <strong style={{ fontSize: "15px", color: "var(--ent-primary, #0f172a)" }}>情景1：员工考勤汇总</strong>
            </div>
            <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ent-text-secondary, #64748b)", lineHeight: "1.5" }}>
              自动配置：“员工考勤记录”（含全表头）与“员工打卡数据”（不显示上班打卡、下班打卡表头）的组合导出。
            </p>
          </button>

          <button
            onClick={applyPreset2}
            style={{
              border: "1px solid var(--ent-border-strong, #cbd5e1)",
              borderRadius: "12px",
              padding: "16px",
              background: "#f8fafc",
              textAlign: "left",
              cursor: "pointer",
              transition: "transform 0.2s, box-shadow 0.2s",
              display: "block",
            }}
            type="button"
            className="preset-btn-hover"
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "20px" }}>📊</span>
              <strong style={{ fontSize: "15px", color: "var(--ent-primary, #0f172a)" }}>情景2：工时汇总</strong>
            </div>
            <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ent-text-secondary, #64748b)", lineHeight: "1.5" }}>
              自动配置：“员工部门工时”与“管理人员部门工时”的组合导出，两张表均会包含部门总工时及对应的“部门人数”。
            </p>
          </button>
        </div>
      </section>

      <section className="legacy-surface legacy-form-surface summary-download-panel">
        <div className="legacy-panel-heading">
          <h3 className="legacy-query-panel-title">下载条件</h3>
          <p className="legacy-query-panel-description">先选择账套、员工范围和下载内容，再生成汇总工作簿。</p>
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
            departments={bootstrap.departments}
            employees={bootstrap.employees}
            filterMode="employee"
            onChange={setSelectedEmployeeIds}
            selectedIds={selectedEmployeeIds}
          />
        </div>

        {/* 8 个工作表多选配置区 */}
        <div className="summary-download-options-group" style={{ marginTop: "24px" }}>
          <div style={{ fontSize: "13.5px", fontWeight: "600", color: "var(--ent-text, #0f172a)", marginBottom: "12px" }}>
            选择导出表格（多选）
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeFinal ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeFinal} onChange={(event) => setIncludeFinal(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>员工考勤记录查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includePunch ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includePunch} onChange={(event) => setIncludePunch(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>员工打卡数据查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeAbnormal ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeAbnormal} onChange={(event) => setIncludeAbnormal(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>员工异常查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeEmpDeptHours ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeEmpDeptHours} onChange={(event) => setIncludeEmpDeptHours(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>员工部门工时查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeMgrAttendance ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeMgrAttendance} onChange={(event) => setIncludeMgrAttendance(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>管理人员考勤查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeMgrOvertime ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeMgrOvertime} onChange={(event) => setIncludeMgrOvertime(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>管理人员加班查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeMgrAnnualLeave ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeMgrAnnualLeave} onChange={(event) => setIncludeMgrAnnualLeave(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>管理人员年假查询</span>
            </label>
            <label className="legacy-check-option" style={{ padding: "12px", border: "1px solid var(--ent-border-strong, #e2e8f0)", borderRadius: "8px", background: includeMgrDeptHours ? "rgba(37,99,235,0.04)" : "#fff" }}>
              <input checked={includeMgrDeptHours} onChange={(event) => setIncludeMgrDeptHours(event.target.checked)} type="checkbox" />
              <span style={{ marginLeft: "8px", fontWeight: "500" }}>管理人员部门工时查询</span>
            </label>
          </div>
        </div>

        {error ? <p className="legacy-inline-error">{error}</p> : null}
        <div className="legacy-actions" style={{ marginTop: "24px" }}>
          <button className="legacy-btn-primary" onClick={handleDownload} type="button">
            下载汇总工作簿
          </button>
        </div>
      </section>

      {/* 动态自定义表头过滤面板 */}
      <section className="legacy-surface legacy-form-surface summary-download-panel" style={{ marginTop: "20px" }}>
        <div className="summary-download-section-head" style={{ marginBottom: "16px" }}>
          <h3 className="legacy-query-panel-title">自定义表头</h3>
          <p className="legacy-query-panel-description">配置各工作表导出的列名。若某张表没有勾选导出，则无需配置表头。</p>
        </div>

        {includeFinal && (
          <HeaderChecklist
            headers={FINAL_HEADERS}
            onToggle={(header) => toggleHeader(header, finalHeaders, setFinalHeaders)}
            onToggleAll={() => toggleAllHeaders(FINAL_HEADERS, finalHeaders, setFinalHeaders)}
            selectedHeaders={finalHeaders}
            title="考勤数据查询工作表"
          />
        )}
        {includePunch && (
          <HeaderChecklist
            headers={PUNCH_HEADERS}
            onToggle={(header) => toggleHeader(header, punchHeaders, setPunchHeaders)}
            onToggleAll={() => toggleAllHeaders(PUNCH_HEADERS, punchHeaders, setPunchHeaders)}
            selectedHeaders={punchHeaders}
            title="打卡数据查询工作表"
          />
        )}
        {includeAbnormal && (
          <HeaderChecklist
            headers={ABNORMAL_HEADERS}
            onToggle={(header) => toggleHeader(header, abnormalHeaders, setAbnormalHeaders)}
            onToggleAll={() => toggleAllHeaders(ABNORMAL_HEADERS, abnormalHeaders, setAbnormalHeaders)}
            selectedHeaders={abnormalHeaders}
            title="员工异常查询工作表"
          />
        )}
        {includeEmpDeptHours && (
          <HeaderChecklist
            headers={EMP_DEPT_HOURS_HEADERS}
            onToggle={(header) => toggleHeader(header, empDeptHoursHeaders, setEmpDeptHoursHeaders)}
            onToggleAll={() => toggleAllHeaders(EMP_DEPT_HOURS_HEADERS, empDeptHoursHeaders, setEmpDeptHoursHeaders)}
            selectedHeaders={empDeptHoursHeaders}
            title="员工部门工时查询工作表"
          />
        )}
        {includeMgrAttendance && (
          <HeaderChecklist
            headers={MGR_ATTENDANCE_HEADERS}
            onToggle={(header) => toggleHeader(header, mgrAttendanceHeaders, setSelfHeaders => setMgrAttendanceHeaders(setSelfHeaders))}
            onToggleAll={() => toggleAllHeaders(MGR_ATTENDANCE_HEADERS, mgrAttendanceHeaders, setMgrAttendanceHeaders)}
            selectedHeaders={mgrAttendanceHeaders}
            title="管理人员考勤查询工作表"
          />
        )}
        {includeMgrOvertime && (
          <HeaderChecklist
            headers={MGR_OVERTIME_HEADERS}
            onToggle={(header) => toggleHeader(header, mgrOvertimeHeaders, setSelfHeaders => setMgrOvertimeHeaders(setSelfHeaders))}
            onToggleAll={() => toggleAllHeaders(MGR_OVERTIME_HEADERS, mgrOvertimeHeaders, setMgrOvertimeHeaders)}
            selectedHeaders={mgrOvertimeHeaders}
            title="管理人员加班查询工作表"
          />
        )}
        {includeMgrAnnualLeave && (
          <HeaderChecklist
            headers={MGR_ANNUAL_LEAVE_HEADERS}
            onToggle={(header) => toggleHeader(header, mgrAnnualLeaveHeaders, setSelfHeaders => setMgrAnnualLeaveHeaders(setSelfHeaders))}
            onToggleAll={() => toggleAllHeaders(MGR_ANNUAL_LEAVE_HEADERS, mgrAnnualLeaveHeaders, setMgrAnnualLeaveHeaders)}
            selectedHeaders={mgrAnnualLeaveHeaders}
            title="管理人员年假查询工作表"
          />
        )}
        {includeMgrDeptHours && (
          <HeaderChecklist
            headers={MGR_DEPT_HOURS_HEADERS}
            onToggle={(header) => toggleHeader(header, mgrDeptHoursHeaders, setSelfHeaders => setMgrDeptHoursHeaders(setSelfHeaders))}
            onToggleAll={() => toggleAllHeaders(MGR_DEPT_HOURS_HEADERS, mgrDeptHoursHeaders, setMgrDeptHoursHeaders)}
            selectedHeaders={mgrDeptHoursHeaders}
            title="管理人员部门工时查询工作表"
          />
        )}
      </section>

      {/* 说明区域 */}
      <section className="summary-download-report-grid" style={{ marginTop: "20px" }}>
        <article className="legacy-surface summary-download-report-card">
          <span className="summary-download-report-label">已选账套</span>
          <strong>{activeAccountSet?.month ?? "-"}</strong>
          <p>{activeAccountSet?.name ?? "请先选择账套月份"}</p>
        </article>
        <article className="legacy-surface summary-download-report-card">
          <span className="summary-download-report-label">已选员工</span>
          <strong>{selectedEmployeeCount === 0 ? "全部员工" : `${selectedEmployeeCount} 人`}</strong>
          <p>{selectedEmployeeCount === 0 ? "当前按所选月份导出全部员工" : "仅导出已选员工范围"}</p>
        </article>
        <article className="legacy-surface summary-download-report-card">
          <span className="summary-download-report-label">待导出工作表</span>
          <strong>{enabledReportsCount} 张表</strong>
          <p>{downloadStatus}</p>
        </article>
      </section>

      {/* 下载说明区域以配合集成回归测试 */}
      <section className="legacy-surface legacy-form-surface summary-download-help-panel" style={{ marginTop: "20px" }}>
        <div className="summary-download-section-head">
          <div>
            <h3 className="legacy-query-panel-title">下载说明</h3>
            <p className="legacy-query-panel-description">汇总为一个 Excel 工作簿（`.xlsx` 格式），可多选装载至不同工作表中。</p>
          </div>
        </div>
      </section>
    </section>
  );
}

function HeaderChecklist({
  headers,
  onToggleAll,
  selectedHeaders,
  title,
  onToggle,
}: {
  headers: string[];
  onToggleAll: () => void;
  selectedHeaders: string[];
  title: string;
  onToggle: (header: string) => void;
}) {
  return (
    <div className="legacy-checklist summary-download-checklist" style={{ padding: "16px 0", borderBottom: "1px solid var(--ent-border-strong, #cbd5e1)" }}>
      <div className="summary-download-checklist-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <p className="legacy-checklist-title" style={{ fontSize: "14px", fontWeight: "600", color: "var(--ent-primary, #0f172a)", margin: 0 }}>
          {title}
        </p>
        <button className="legacy-btn-ghost" onClick={onToggleAll} type="button" style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: "12.5px" }}>
          {selectedHeaders.length === headers.length ? "取消全选" : "全选"}
        </button>
      </div>
      <div className="legacy-badges" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {headers.map((header) => (
          <label key={header} className="legacy-badge" style={{ display: "inline-flex", alignItems: "center", background: "#f1f5f9", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}>
            <input checked={selectedHeaders.includes(header)} onChange={() => onToggle(header)} type="checkbox" style={{ marginRight: "4px" }} />
            <span>{header}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

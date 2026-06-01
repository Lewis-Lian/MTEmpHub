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
  "人员名称",
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

export default function SummaryDownloadPage() {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includePunch, setIncludePunch] = useState(true);
  const [finalHeaders, setFinalHeaders] = useState<string[]>(FINAL_HEADERS);
  const [punchHeaders, setPunchHeaders] = useState<string[]>([
    "日期",
    "员工编号",
    "员工姓名",
    "部门",
    "原始打卡数据",
    "打卡次数",
    "实出勤小时",
  ]);

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
    if (!includeFinal && !includePunch) {
      setError("请至少选择一种报表。");
      return;
    }
    setError("");
    const query = new URLSearchParams();
    if (selectedMonth) {
      query.set("month", selectedMonth);
    }
    selectedEmployeeIds.forEach((employeeId) => query.append("emp_ids", String(employeeId)));
    query.set("sheets", [includeFinal ? "final" : "", includePunch ? "punch" : ""].filter(Boolean).join(","));
    query.set("final_headers", finalHeaders.join(","));
    query.set("punch_headers", punchHeaders.join(","));
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
  const enabledReports = [includeFinal, includePunch].filter(Boolean).length;
  const downloadStatus =
    enabledReports === 0
      ? "未选择报表"
      : selectedMonth
        ? `已选 ${enabledReports} 份报表，等待下载`
        : "请先选择账套月份";

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">查询中心</p>
          <h2 className="legacy-page-title">汇总下载</h2>
          <p className="legacy-page-description">选择账套、员工范围和字段列，下载合并后的月度汇总工作簿。</p>
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

        <div className="legacy-options-row">
          <span className="legacy-options-label">下载内容</span>
          <label className="legacy-check-option">
            <input checked={includeFinal} onChange={(event) => setIncludeFinal(event.target.checked)} type="checkbox" />
            <span>考勤数据</span>
          </label>
          <label className="legacy-check-option">
            <input checked={includePunch} onChange={(event) => setIncludePunch(event.target.checked)} type="checkbox" />
            <span>打卡数据</span>
          </label>
        </div>

        {error ? <p className="legacy-inline-error">{error}</p> : null}
        <div className="legacy-actions">
          <button className="legacy-btn-primary" onClick={handleDownload} type="button">
            下载汇总工作簿
          </button>
        </div>
      </section>

      <section className="summary-download-report-grid">
        <article className="legacy-surface summary-download-report-card">
          <span className="summary-download-report-label">报表说明</span>
          <strong>考勤数据查询工作表</strong>
          <p>包含考勤天数、请假次数与时长、工时、半勤天数，以及与月度汇总相关的统计字段。</p>
        </article>
        <article className="legacy-surface summary-download-report-card">
          <span className="summary-download-report-label">报表说明</span>
          <strong>打卡数据查询工作表</strong>
          <p>包含日期、原始打卡、上下班打卡、打卡次数、实出勤小时、迟到早退与异常原因。</p>
        </article>
      </section>

      <section className="summary-download-metric-grid">
        <article className="legacy-surface summary-download-metric-card">
          <span className="summary-download-metric-label">已选员工</span>
          <strong>{selectedEmployeeCount === 0 ? "全部员工" : `${selectedEmployeeCount} 人`}</strong>
          <p>{selectedEmployeeCount === 0 ? "当前按所选月份导出全部员工" : "仅导出已选员工范围"}</p>
        </article>
        <article className="legacy-surface summary-download-metric-card">
          <span className="summary-download-metric-label">当前账套</span>
          <strong>{activeAccountSet?.month ?? "-"}</strong>
          <p>{activeAccountSet?.name ?? "请先选择账套月份"}</p>
        </article>
        <article className="legacy-surface summary-download-metric-card">
          <span className="summary-download-metric-label">可用报表</span>
          <strong>{enabledReports}</strong>
          <p>{enabledReports === 2 ? "考勤数据 + 打卡数据" : enabledReports === 1 ? "已选择单张报表" : "尚未选择"}</p>
        </article>
        <article className="legacy-surface summary-download-metric-card">
          <span className="summary-download-metric-label">下载状态</span>
          <strong>{enabledReports === 0 ? "等待选择" : "等待操作"}</strong>
          <p>{downloadStatus}</p>
        </article>
      </section>

      <section className="legacy-surface legacy-form-surface summary-download-panel">
        <div className="summary-download-section-head">
          <div>
            <h3 className="legacy-query-panel-title">自定义表头</h3>
            <p className="legacy-query-panel-description">按工作表分别选择需要导出的字段列，生成时按当前勾选结果输出。</p>
          </div>
        </div>
        <HeaderChecklist
          headers={FINAL_HEADERS}
          onToggle={(header) => toggleHeader(header, finalHeaders, setFinalHeaders)}
          onToggleAll={() => toggleAllHeaders(FINAL_HEADERS, finalHeaders, setFinalHeaders)}
          selectedHeaders={finalHeaders}
          title="考勤数据查询工作表"
        />
        <HeaderChecklist
          headers={PUNCH_HEADERS}
          onToggle={(header) => toggleHeader(header, punchHeaders, setPunchHeaders)}
          onToggleAll={() => toggleAllHeaders(PUNCH_HEADERS, punchHeaders, setPunchHeaders)}
          selectedHeaders={punchHeaders}
          title="打卡数据查询工作表"
        />
      </section>

      <section className="legacy-surface legacy-form-surface summary-download-help-panel">
        <div className="summary-download-section-head">
          <div>
            <h3 className="legacy-query-panel-title">下载说明</h3>
            <p className="legacy-query-panel-description">汇总为一个 Excel 文件，按勾选内容生成工作表，并沿用当前自定义表头设置。</p>
          </div>
        </div>
        <div className="summary-download-help-box">
          <h4>一键下载全部</h4>
          <p>文件格式为 Excel（`.xlsx`），包含以下工作表：</p>
          <ul className="summary-download-help-list">
            <li>考勤数据查询：部门名称、人员编号、人员名称、考勤天数、各类请假次数与时长、工时、半勤天数。</li>
            <li>打卡数据查询：日期、员工编号、员工姓名、部门、原始打卡数据、上下班打卡、打卡次数、实出勤小时、迟到早退分钟、异常原因。</li>
          </ul>
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
    <div className="legacy-checklist summary-download-checklist">
      <div className="summary-download-checklist-head">
        <p className="legacy-checklist-title">{title}</p>
        <button className="legacy-btn-ghost" onClick={onToggleAll} type="button">
          {selectedHeaders.length === headers.length ? "取消全选" : "全选"}
        </button>
      </div>
      <div className="legacy-badges">
        {headers.map((header) => (
          <label key={header} className="legacy-badge">
            <input checked={selectedHeaders.includes(header)} onChange={() => onToggle(header)} type="checkbox" />
            <span>{header}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

import type { CSSProperties } from "react";
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

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <p style={tagStyle}>查询中心</p>
          <h2 style={titleStyle}>汇总下载</h2>
          <p style={descriptionStyle}>选择账套、员工范围和字段列，下载合并后的月度汇总工作簿。</p>
        </div>
      </header>

      <section style={panelStyle}>
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

        <EmployeePicker
          employees={bootstrap.employees}
          filterMode="employee"
          onChange={setSelectedEmployeeIds}
          selectedIds={selectedEmployeeIds}
        />

        <div style={optionsRowStyle}>
          <label style={optionLabelStyle}>
            <input checked={includeFinal} onChange={(event) => setIncludeFinal(event.target.checked)} type="checkbox" />
            <span>包含考勤汇总表</span>
          </label>
          <label style={optionLabelStyle}>
            <input checked={includePunch} onChange={(event) => setIncludePunch(event.target.checked)} type="checkbox" />
            <span>包含打卡明细表</span>
          </label>
        </div>

        <HeaderChecklist headers={FINAL_HEADERS} selectedHeaders={finalHeaders} title="考勤汇总字段" onToggle={(header) => toggleHeader(header, finalHeaders, setFinalHeaders)} />
        <HeaderChecklist headers={PUNCH_HEADERS} selectedHeaders={punchHeaders} title="打卡明细字段" onToggle={(header) => toggleHeader(header, punchHeaders, setPunchHeaders)} />

        {error ? <p style={errorStyle}>{error}</p> : null}
        <div style={actionsStyle}>
          <button onClick={handleDownload} style={primaryButtonStyle} type="button">
            下载汇总工作簿
          </button>
        </div>
      </section>
    </section>
  );
}

function HeaderChecklist({
  headers,
  selectedHeaders,
  title,
  onToggle,
}: {
  headers: string[];
  selectedHeaders: string[];
  title: string;
  onToggle: (header: string) => void;
}) {
  return (
    <div style={checklistWrapStyle}>
      <p style={checklistTitleStyle}>{title}</p>
      <div style={badgesStyle}>
        {headers.map((header) => (
          <label key={header} style={badgeStyle}>
            <input checked={selectedHeaders.includes(header)} onChange={() => onToggle(header)} type="checkbox" />
            <span>{header}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
};

const heroStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "24px",
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
  color: "#4b5d67",
  lineHeight: 1.7,
  maxWidth: "760px",
};

const panelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
  display: "grid",
  gap: "20px",
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

const optionsRowStyle: CSSProperties = {
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
};

const optionLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
};

const checklistWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const checklistTitleStyle: CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: "#183153",
};

const badgesStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 12px",
  borderRadius: "999px",
  background: "#f2f6f0",
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

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b42318",
};

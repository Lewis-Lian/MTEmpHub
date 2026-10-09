import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { businessMonth, ledgerExportUrl } from "../api/mealLedgers";
import "./meal-ticket.css";
import "./meal-ledger.css";

const reports = [
  { key: "recharge", label: "月度充值记录", permission: "meal_ticket_query" },
  { key: "department", label: "部门菜票登记", permission: "meal_ticket_query" },
  { key: "external", label: "外来人员领用", permission: "meal_ledger_query" },
  { key: "annual", label: "全年菜票汇总", permission: "meal_ledger_query" },
  { key: "clearance", label: "月末取款明细", permission: "meal_ledger_query" },
];
export default function MealDownloadPage() {
  const [allowed, setAllowed] = useState<typeof reports>([]);
  const [report, setReport] = useState("");
  const [month, setMonth] = useState(businessMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [period, setPeriod] = useState("month");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    apiRequest<{ role: string; page_permissions?: Record<string, boolean> }>("/api/auth/me").then(user => {
      if (cancelled) return;
      const visible = reports.filter(r => user.role === "admin" || user.page_permissions?.[r.permission] || (r.key === "department" && user.page_permissions?.meal_ledger_query));
      setAllowed(visible); setReport(visible[0]?.key ?? "");
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "权限读取失败"); });
    return () => { cancelled = true; };
  }, []);
  const download = async () => {
    setError("");
    try {
      const yearly = report === "annual" || (report !== "recharge" && period === "year");
      const response = await fetch(ledgerExportUrl(report, yearly ? "" : month, year), { credentials: "include" });
      if (!response.ok) {
        const data = await response.json(); throw new Error(data.error || "下载失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `菜票_${report}_${yearly ? year : month}.xlsx`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "下载失败"); }
  };
  return <section className="meal-ticket-page meal-ledger-page">
    <header className="meal-ticket-heading"><div><p className="meal-ticket-eyebrow">下载中心</p><h1>菜票存档下载</h1><p>按对应表格格式下载 Excel，保存导出时的账目结果。</p></div></header>
    <div className="meal-ticket-panel meal-ledger-form">
      <label>报表<select value={report} onChange={e => setReport(e.target.value)}>{allowed.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      {report !== "annual" && report !== "recharge" && <label>下载期间<select value={period} onChange={e => setPeriod(e.target.value)}><option value="month">单月</option><option value="year">全年</option></select></label>}
      {report === "annual" || (report !== "recharge" && period === "year") ? <label>年份<input type="number" min="1" max="9999" value={year} onChange={e => setYear(e.target.value)} /></label> : <label>{report === "recharge" || report === "department" ? "充值月份" : "业务月份"}<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>}
      <button className="meal-ticket-button is-primary" disabled={!report} onClick={download}>下载存档表格</button>
    </div>
    {error && <p role="alert" className="meal-ticket-error">{error}</p>}
    <div className="meal-ticket-panel"><p>月度充值记录包含员工异常、员工充值和管理人员三个工作表。异常次数仅作为依据展示，金额采用当前菜票规则及实际登记结果。</p><p>部门登记、外来人员领用、全年汇总、取款明细分别下载。纸质领用单列，未录入消费保留空值。</p></div>
  </section>;
}

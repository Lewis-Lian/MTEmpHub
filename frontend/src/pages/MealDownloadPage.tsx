import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { businessMonth, ledgerBatchExportUrl, ledgerExportUrl } from "../api/mealLedgers";
import { DownloadIcon, GridIcon, TicketIcon, DatabaseIcon, BarChartIcon } from "../components/icons";
import DepartmentLayoutEditor from "./DepartmentLayoutEditor";
import "./meal-ticket.css";
import "./meal-ledger.css";
import "./meal-download.css";

const reports = [
  { key: "recharge", label: "月度充值记录", permission: "meal_ticket_query", desc: "员工异常、员工充值和管理人员充值，共三个工作表。" },
  { key: "department", label: "部门菜票发放汇总", permission: "meal_ticket_query", desc: "按固定部门排版，员工、客人充卡和纸质菜票分开列示。" },
  { key: "external", label: "外来人员领用", permission: "meal_ledger_query", desc: "客人充卡、纸质菜票领用及到账明细。" },
  { key: "clearance", label: "月末取款明细", permission: "meal_ledger_query", desc: "月末清零取款金额、处理日期及登记备注。" },
  { key: "annual", label: "全年菜票汇总", permission: "meal_ledger_query", desc: "全年各月充值、消费和收回金额；未录入的消费保留空值。" },
];

export default function MealDownloadPage() {
  const [allowed, setAllowed] = useState<typeof reports>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [month, setMonth] = useState(businessMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLayout, setShowLayout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ role: string; page_permissions?: Record<string, boolean> }>("/api/auth/me").then(user => {
      if (cancelled) return;
      setIsAdmin(user.role === "admin");
      setAllowed(reports.filter(r => user.role === "admin" || user.page_permissions?.[r.permission]
        || (r.key === "department" && user.page_permissions?.meal_ledger_query)));
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "权限读取失败"); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const monthly = allowed.filter(r => r.key !== "annual");
  const annual = allowed.find(r => r.key === "annual");
  const selectedReports = allowed.filter(r => selected.includes(r.key));
  const reportIcons = { recharge: TicketIcon, department: GridIcon, external: TicketIcon, clearance: DatabaseIcon, annual: BarChartIcon };
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) > 0;
  const validYear = /^\d{1,4}$/.test(year) && Number(year) > 0;
  const [monthYear, monthIndex] = month.split("-").map(Number);
  const attendanceMonth = validMonth ? `${monthIndex === 1 ? monthYear - 1 : monthYear}-${String(monthIndex === 1 ? 12 : monthIndex - 1).padStart(2, "0")}` : "—";
  const toggle = (key: string) => {
    setSelected(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]);
    setMessage("");
  };

  const download = async (keys: string[], yearly = false) => {
    if (busy || !keys.length) return;
    setError(""); setMessage("");
    if ((keys.some(key => key !== "annual") && !yearly && !validMonth)
      || ((yearly || keys.includes("annual")) && !validYear)) {
      setError("请选择有效的月份或年份"); return;
    }
    setBusy(true);
    try {
      const batch = keys.length > 1;
      const single = reports.find(r => r.key === keys[0])!;
      const url = batch ? ledgerBatchExportUrl(keys, month, year)
        : ledgerExportUrl(keys[0], yearly || keys[0] === "annual" ? "" : month, year);
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        const data = await response.json(); throw new Error(data.error || "下载失败");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = batch ? `菜票存档_${month}.zip` : `${single.label}_${yearly || keys[0] === "annual" ? year : month}.xlsx`;
      link.click(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setMessage(`已生成 ${keys.length} 份报表，下载已开始。`);
    } catch (e) { setError(e instanceof Error ? e.message : "下载失败"); }
    finally { setBusy(false); }
  };

  const reportCard = (report: typeof reports[number]) => {
    const Icon = reportIcons[report.key as keyof typeof reportIcons];
    return <article key={report.key}
    className={`meal-download-card${selected.includes(report.key) ? " is-selected" : ""}`}>
    <div className="meal-download-card-top"><span className="meal-download-report-icon" aria-hidden="true"><Icon /></span><label className="meal-download-card-choice"><strong>{report.label}</strong><input type="checkbox" aria-label={report.label}
      checked={selected.includes(report.key)} disabled={busy} onChange={() => toggle(report.key)} /></label></div>
    <p>{report.desc}</p>
    <div className="meal-download-card-actions"><span>Excel · {report.key === "annual" ? `${year} 全年` : month}</span>
      <button type="button" className="meal-ticket-button is-link" aria-label={`单独下载${report.label}`} disabled={busy}
        onClick={() => download([report.key])}>单独下载</button>
      {report.key === "department" && isAdmin && <button type="button" className="meal-ticket-button is-link"
        aria-haspopup="dialog" disabled={busy} onClick={() => setShowLayout(true)}>调整排版</button>}
    </div>
  </article>;
  };

  return <section className="meal-ticket-page meal-ledger-page meal-download-page">
    <header className="meal-ticket-heading"><div><p className="meal-ticket-eyebrow">下载中心</p>
      <h1>菜票存档下载</h1><p>选好月份，勾选所需报表，一次下载。多份报表自动打包为 ZIP。</p></div></header>
    {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
    {!ready ? <p>正在读取可下载报表…</p> : allowed.length === 0 ? <p>暂无可下载的报表。</p> : <>
      {monthly.length > 0 && <section className="meal-ticket-panel meal-download-monthly" aria-label="月度报表">
        <div className="meal-download-toolbar"><div><h2>月度报表</h2><p>充值 {month || "—"} ／ 考勤 {attendanceMonth}；部门汇总表头采用考勤月份。</p></div>
          <label>充值月份<input type="month" value={month} disabled={busy} onChange={event => { setMonth(event.target.value); setMessage(""); }} /></label>
        </div>
        <div className="meal-download-selection"><span>可多选需要的报表</span><button type="button" disabled={busy}
          onClick={() => { setSelected(current => [...new Set([...current, ...monthly.map(r => r.key)])]); setMessage(""); }}>全选月度报表</button>
          <button type="button" disabled={busy || selected.length === 0} onClick={() => { setSelected([]); setMessage(""); }}>清空选择</button></div>
        <div className="meal-download-grid">{monthly.map(reportCard)}</div>
      </section>}
      {showLayout && isAdmin && <DepartmentLayoutEditor rechargeMonth={month} onClose={() => setShowLayout(false)} />}
      {annual && <section className="meal-ticket-panel meal-download-annual" aria-label="全年报表">
        <div className="meal-download-toolbar"><div><h2>全年报表</h2><p>年份独立选择，可与月度报表一起打包。</p></div>
          <label>全年报表年份<input type="number" min="1" max="9999" value={year} disabled={busy} onChange={event => { setYear(event.target.value); setMessage(""); }} /></label></div>
        {reportCard(annual)}
      </section>}
      <div className="meal-ticket-panel meal-download-bar" aria-busy={busy}>
        <div><strong>已选 {selectedReports.length} 份报表</strong><span>{selectedReports.length > 1 ? "打包为一个 ZIP，保留每份 Excel 格式" : "单份报表直接下载 Excel"}</span></div>
        <button type="button" className="meal-ticket-button is-primary" disabled={busy || !selectedReports.length}
          onClick={() => download(selectedReports.map(r => r.key))}><DownloadIcon />{busy ? "正在生成…" : selectedReports.length ? `下载已选 ${selectedReports.length} 份报表` : "请选择报表"}</button>
        {message && <p role="status">{message}</p>}
      </div>
      {monthly.some(r => r.key !== "recharge") && <details className="meal-ticket-panel meal-download-more"><summary>更多全年明细下载</summary>
        <p>按上方全年报表年份（{year}），下载各月明细。</p>
        {monthly.filter(r => r.key !== "recharge").map(r => <button key={r.key} type="button" className="meal-ticket-button" disabled={busy}
          onClick={() => download([r.key], true)}>{year}年{r.label}</button>)}
        {!annual && <label>全年报表年份<input type="number" min="1" max="9999" value={year} disabled={busy} onChange={event => setYear(event.target.value)} /></label>}
      </details>}
      <details className="meal-ticket-panel meal-download-more"><summary>报表说明</summary><p>月度充值记录包含员工异常、员工充值和管理人员三个工作表。客人充卡与纸质菜票分开列示，未录入的消费保留空值。</p></details>
    </>}
  </section>;
}

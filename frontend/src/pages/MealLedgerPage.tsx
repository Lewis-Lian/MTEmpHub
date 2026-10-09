import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { businessMonth, confirmLedger, fetchAnnual, fetchLedger, fetchLedgerImports, money, previewLedger, saveLedger, voidLedger,
  type AnnualLedger, type DepartmentLedger, type LedgerImport, type LedgerImportRow, type LedgerKind, type LedgerRecord } from "../api/mealLedgers";
import QueryTable from "../components/query/QueryTable";
import LoadingState from "../components/feedback/LoadingState";
import "./meal-ticket.css";
import "./meal-ledger.css";

type View = "department" | "external" | "clearance" | "annual";
const titles = { department: "部门菜票登记", external: "外来人员领用", clearance: "月末取款记录", annual: "全年菜票汇总" };
const descriptions = {
  department: "部门金额取对应人员的净实际发放合计，登记信息不产生额外发放。",
  external: "外来人员独立登记，区分充卡与纸质领用。",
  clearance: "在菜票软件完成余额清零后登记，卡余额即当次取款金额，不影响菜票发放结清。",
  annual: "按实际业务月份汇总。纸质领用单列，收回取实际清零记录，消费未录入保持空值。",
};
const initialForm = () => ({ name: "", emp_no: "", dept_name: "", card_no: "", amount: "", category: "card", unit: "", period: "", days: "", registrar: "", remark: "", floor2: "", floor3: "", date: "" });

export default function MealLedgerPage({ kind }: { kind: View }) {
  const recordKind: LedgerKind = kind === "annual" ? "consumption" : kind;
  const [month, setMonth] = useState(businessMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [department, setDepartment] = useState<DepartmentLedger | null>(null);
  const [annual, setAnnual] = useState<AnnualLedger | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [voidTarget, setVoidTarget] = useState<LedgerRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LedgerImport | null>(null);
  const [history, setHistory] = useState<LedgerImport[]>([]);
  const request = useRef({ signature: "", key: "" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setDepartment(null); setAnnual(null); setRecords([]);
    const data = kind === "annual" ? fetchAnnual(year) : kind === "department" ? fetchLedger<DepartmentLedger>(kind, month) : fetchLedger<LedgerRecord[]>(kind, month);
    Promise.all([apiRequest<{ role: string }>("/api/auth/me"), data]).then(([user, result]) => {
      if (cancelled) return;
      setAdmin(user.role === "admin");
      if (kind === "annual") setAnnual(result as AnnualLedger);
      else if (kind === "department") setDepartment(result as DepartmentLedger);
      else setRecords(result as LedgerRecord[]);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "台账加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, month, year, refresh]);
  useEffect(() => { setForm(initialForm()); setPreview(null); setHistory([]); setFile(null); setMessage(""); }, [kind]);
  const field = (key: keyof ReturnType<typeof initialForm>, label: string, type = "text") => <label>{label}<input type={type} step={type === "number" ? "0.01" : undefined} required={type === "date"} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>;
  async function operate(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function save() {
    await operate(async () => {
      const body = { ...form, month, date: form.date || (kind === "annual" || kind === "department" ? `${month}-01` : "") };
      const signature = JSON.stringify(body);
      if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
      await saveLedger(recordKind, { ...body, request_key: request.current.key });
      request.current = { signature: "", key: "" };
      setForm(initialForm()); setRefresh(n => n + 1); setMessage("记录已保存");
    });
  }
  async function upload() {
    await operate(async () => {
      if (!file) throw new Error("请选择 xlsx 文件");
      const body = new FormData(); body.set("file", file); body.set("kind", recordKind); body.set("month", month);
      setPreview(await previewLedger(body));
    });
  }
  const editImport = (index: number, changes: Partial<LedgerImportRow>) => setPreview(p => p ? { ...p, rows: p.rows.map(r => r.index === index ? { ...r, ...changes } : r) } : p);
  const visible = records.filter(r => (!search || `${r.emp_no}${r.name}${r.dept_name}${r.card_no}`.includes(search)) && (!category || r.category === category));
  return <section className="meal-ticket-page meal-ledger-page">
    <header className="meal-ticket-heading"><div><p className="meal-ticket-eyebrow">菜票中心</p><h1>{titles[kind]}</h1><p>{descriptions[kind]}</p></div></header>
    <div className="meal-ticket-panel meal-ledger-form">
      {kind === "annual" && <label>汇总年份<input type="number" min="1" max="9999" value={year} onChange={e => setYear(e.target.value)} /></label>}
      <label>{kind === "department" ? "充值月份" : kind === "annual" ? "消费录入月份" : "业务月份"}<input type="month" value={month} onChange={e => { setMonth(e.target.value); setForm(f => ({ ...f, date: "" })); }} /></label>
      {(kind === "external" || kind === "clearance") && <label>搜索记录<input placeholder="工号、姓名、部门或卡号" value={search} onChange={e => setSearch(e.target.value)} /></label>}
      {kind === "external" && <label>领用类别<select value={category} onChange={e => setCategory(e.target.value)}><option value="">全部类别</option><option value="card">充卡</option><option value="paper">纸质</option></select></label>}
    </div>
    {error && <p role="alert" className="meal-ticket-error">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <LoadingState message="正在读取台账…" /> : <>
      <div className="meal-ticket-panel">
        {kind === "department" && department && <><p>{department.status === "draft" ? "草稿" : department.status === "no_batch" ? "本月没有人员核算；历史登记仅供对照" : "已确认核算"}</p><QueryTable headers={["部门", "人数", "应发合计", "实际发放合计", "登记人", "备注", "历史原账金额"]}
          rows={department.items.map(r => [r.dept_name, r.count, money(r.due_amount), money(r.paid_amount), r.registrar, r.remark, r.historical_amount == null ? "—" : money(r.historical_amount)])} /></>}
        {kind === "annual" && annual && <><p>消费已录入 {annual.consumption_months}/12 月 · 全年充值 {money(annual.totals.recharge_amount)} 元 · 收回 {money(annual.totals.recovered_amount)} 元</p><QueryTable headers={["月份", "员工/管理人员充值", "外来充卡", "充值合计", "纸质领用", "二楼消费", "三楼消费", "消费合计", "收回金额", "历史充值原额", "历史收回原额"]}
          rows={annual.months.map(r => [r.month, money(r.employee_amount), money(r.external_card_amount), money(r.recharge_amount), money(r.paper_amount), money(r.floor2_amount), money(r.floor3_amount), money(r.consumption_amount), money(r.recovered_amount), r.historical_recharge_amount == null ? "—" : money(r.historical_recharge_amount), r.historical_recovered_amount == null ? "—" : money(r.historical_recovered_amount)])} /></>}
        {(kind === "external" || kind === "clearance") && <><p>有效金额 {money(visible.filter(r => !r.voided).reduce((sum, r) => sum + r.amount, 0))} 元 · {visible.length} 条（包含作废历史）</p><QueryTable headers={["日期", "工号", "姓名", "部门", ...(kind === "external" ? ["类别", "外来单位", "期间", "天数"] : []), "卡号", "金额", "备注", "状态", "操作"]}
          rows={visible.map(r => [r.date, r.emp_no, r.name, r.dept_name, ...(kind === "external" ? [r.category === "card" ? "充卡" : "纸质", r.unit, r.period, r.days] : []), r.card_no, money(r.amount), r.remark, r.voided ? `已作废：${r.void_reason}` : "有效", admin && !r.voided ? <button className="meal-ticket-button" disabled={busy} onClick={() => { setVoidTarget(r); setVoidReason(""); }}>作废</button> : "—"])} /></>}
      </div>
      {admin && <div className="meal-ticket-panel"><h2>{kind === "annual" ? "录入月度消费" : kind === "department" ? "保存登记信息" : "登记记录"}</h2>
        <form className="meal-ledger-form" onSubmit={e => { e.preventDefault(); void save(); }}>
          {(kind === "external" || kind === "clearance") && <>{field("name", "姓名")}{field("emp_no", "人员编号")}{field("date", "处理日期", "date")}{field("card_no", "卡号")}{field("amount", kind === "clearance" ? "清零取款金额" : "发放金额", "number")}</>}
          {kind !== "annual" && field("dept_name", "部门")}
          {kind === "external" && <><label>类别<select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}><option value="card">充卡</option><option value="paper">纸质</option></select></label>{field("unit", "外来单位/人员")}{field("period", "服务期间")}{field("days", "天数")}</>}
          {(kind === "department" || kind === "external") && field("registrar", kind === "department" ? "登记人" : "填表人")}
          {kind === "annual" && <>{field("floor2", "二楼消费金额", "number")}{field("floor3", "三楼消费金额", "number")}</>}
          {field("remark", "备注")}<button className="meal-ticket-button is-primary" disabled={busy || loading}>保存记录</button>
        </form><p>已保存记录保留历史。月度消费和部门登记再次保存时，会替代本月有效登记并保留旧版本。</p>
      </div>}
    </>}
    {admin && <div className="meal-ticket-panel"><h2>历史表格导入</h2><p>先预览，逐行确认年月和处理日期。导入不会执行充值或清零。</p>
      <div className="meal-ledger-form"><label>导入文件<input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><button className="meal-ticket-button" disabled={busy || !file} onClick={upload}>预览导入</button>
        <button className="meal-ticket-button" disabled={busy} onClick={() => operate(async () => setHistory((await fetchLedgerImports()).filter(r => r.kind === recordKind)))}>查看导入历史</button></div>
      {history.map(h => <p key={h.id}><button className="meal-ticket-button" onClick={() => setPreview(h)}>{h.filename} · {h.status === "confirmed" ? "已导入" : "待确认"}</button></p>)}
      {preview && <div className="meal-ledger-import"><h3>{preview.filename} · {preview.rows.length} 行 · {preview.status === "confirmed" ? "已导入" : "预览未入账"}</h3>
        <p>页名或标题年份可能与文件名不一致，请按实际业务逐行确认。导入年度表的充值与收回原额不叠加到正式资金记录。</p>
        <QueryTable headers={["来源", "工号/姓名/部门", "月份", "日期", recordKind === "consumption" ? "二楼消费" : "金额", ...(recordKind === "consumption" ? ["三楼消费"] : recordKind === "external" ? ["领用类别"] : []), "说明", "跳过", "确认另一笔"]}
          rows={preview.rows.map(r => [ `${r.sheet}:${r.row}`, <div>{r.emp_no}<input aria-label={`第${r.index + 1}行姓名`} value={r.name} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { name: e.target.value })} /><input aria-label={`第${r.index + 1}行部门`} value={r.dept_name} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { dept_name: e.target.value })} /></div>,
            <input aria-label={`第${r.index + 1}行月份`} type="month" value={r.month} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { month: e.target.value })} />,
            <input aria-label={`第${r.index + 1}行日期`} type="date" value={r.date} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { date: e.target.value })} />,
            <input aria-label={`第${r.index + 1}行金额`} value={(recordKind === "consumption" ? r.floor2 : recordKind === "department" ? r.historical_amount : r.amount) ?? ""} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, recordKind === "consumption" ? { floor2: e.target.value } : recordKind === "department" ? { historical_amount: e.target.value } : { amount: e.target.value })} />,
            ...(recordKind === "consumption" ? [<input aria-label={`第${r.index + 1}行三楼消费`} value={r.floor3 ?? ""} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { floor3: e.target.value })} />] : recordKind === "external" ? [<select aria-label={`第${r.index + 1}行领用类别`} value={r.category} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { category: e.target.value })}><option value="">请选择</option><option value="card">充卡</option><option value="paper">纸质</option></select>] : []),
            `${r.error} ${r.warning}`, <input aria-label={`跳过第${r.index + 1}行`} type="checkbox" checked={r.skip ?? false} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { skip: e.target.checked })} />,
            recordKind === "external" || recordKind === "clearance" ? <input aria-label={`确认第${r.index + 1}行为另一笔`} type="checkbox" checked={r.accept_duplicate ?? false} disabled={preview.status === "confirmed"} onChange={e => editImport(r.index, { accept_duplicate: e.target.checked })} /> : "—",
          ])} />
        {preview.status !== "confirmed" && <button className="meal-ticket-button is-primary" disabled={busy} onClick={() => operate(async () => { setPreview(await confirmLedger(preview)); setRefresh(n => n + 1); setMessage("导入已完成"); })}>确认导入</button>}
      </div>}
    </div>}
    {voidTarget && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="作废台账记录"><h2>作废 {voidTarget.name} 的记录</h2><label>作废原因<input value={voidReason} onChange={e => setVoidReason(e.target.value)} /></label><button className="meal-ticket-button" disabled={busy || !voidReason.trim()} onClick={() => operate(async () => { await voidLedger(voidTarget.id, voidReason); setVoidTarget(null); setRefresh(n => n + 1); })}>确认作废</button><button className="meal-ticket-button" disabled={busy} onClick={() => setVoidTarget(null)}>取消</button></section></div>}
  </section>;
}

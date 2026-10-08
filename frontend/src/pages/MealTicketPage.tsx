import { useEffect, useRef, useState } from "react";
import { fetchMe } from "../api/auth";
import { apiRequest } from "../api/client";
import { fetchMealBatch, mutateMealBatch, mealExportUrl, fetchMealImports, previewMealImport, confirmMealImport, compareMealImport } from "../api/mealTickets";
import type { MealBatch, MealItem, MealImport, MealImportRow, MealComparison } from "../api/mealTickets";
import QueryTable from "../components/query/QueryTable";
import "./meal-ticket.css";

const money = (n: number) => n.toFixed(2);
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

export default function MealTicketPage({ view = "calculation" }: { view?: "calculation" | "payments" | "history" }) {
  const historical = view === "history";
  const paymentView = view === "payments";
  const [admin, setAdmin] = useState(false);
  const [month, setMonth] = useState(() => {
    try { return sessionStorage.getItem(`meal-ticket-month-${view}`) || thisMonth(); } catch { return thisMonth(); }
  });
  const [batch, setBatch] = useState<MealBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [target, setTarget] = useState<MealItem | null>(null);
  const [action, setAction] = useState("adjustments");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [reversalId, setReversalId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulk, setBulk] = useState(false);
  const [detail, setDetail] = useState<MealItem | null>(null);
  const [imports, setImports] = useState<MealImport[]>([]);
  const [preview, setPreview] = useState<MealImport | null>(null);
  const [comparison, setComparison] = useState<MealComparison[]>([]);
  const [monthKind, setMonthKind] = useState("recharge");
  const [file, setFile] = useState<File | null>(null);
  const [people, setPeople] = useState<Array<{ id: number; emp_no: string; name: string }>>([]);
  const generation = useRef(0);
  const requestKeys = useRef<Record<number, string>>({});

  useEffect(() => { fetchMe().then(u => setAdmin(u.role === "admin")).catch(e => setError(e.message)); }, []);
  useEffect(() => { setComparison([]); }, [preview]);
  useEffect(() => { try { sessionStorage.setItem(`meal-ticket-month-${view}`, month); } catch { /* Session storage may be disabled. */ } }, [month, view]);
  useEffect(() => {
    const id = ++generation.current;
    setBatch(null); setPreview(null); setTarget(null); setDetail(null); setSelected([]); setError("");
    setBusy(true);
    const task = historical ? fetchMealImports().then(r => { if (id === generation.current) setImports(r); })
      : fetchMealBatch(month).then(r => { if (id === generation.current) setBatch(r); });
    task.catch(e => { if (id === generation.current) setError(e.message); }).finally(() => { if (id === generation.current) setBusy(false); });
  }, [month, historical]);
  useEffect(() => {
    if (historical && admin) apiRequest<Array<{ id: number; emp_no: string; name: string }>>("/api/admin/employees?status=all")
      .then(r => setPeople(r)).catch(e => setError(e.message));
  }, [historical, admin]);

  async function operate(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function mutate(endpoint: string, values: object = {}) {
    await operate(async () => {
      const next = await mutateMealBatch(endpoint, { batch_id: batch?.id, version: batch?.version, ...values });
      setBatch(next); setTarget(null);
    });
  }
  function openForm(item: MealItem, endpoint: string, reversal?: number) {
    setTarget(item); setAction(endpoint); setAmount(endpoint === "adjustments" ? "" : money(Math.abs(item.difference)));
    setReason(""); setReversalId(reversal ?? null); requestKeys.current = { [item.id]: crypto.randomUUID() };
  }
  async function save() {
    if (!target || !batch) return;
    const values = { item_id: target.id, amount, reason, kind: action, date, reference: reason,
      reversal_id: reversalId, request_key: requestKeys.current[target.id] };
    await mutate(action === "adjustments" ? action : "payments", values);
  }
  async function saveBulk() {
    if (!batch) return;
    await operate(async () => {
      let current = batch;
      for (const id of selected) {
        const item = current.items.find(i => i.id === id);
        if (!item || item.difference <= 0) continue;
        const next = await mutateMealBatch("payments", { batch_id: current.id, version: current.version, item_id: id,
          amount: money(item.difference), kind: "recharge", date, reference: reason,
          request_key: requestKeys.current[id] ?? (requestKeys.current[id] = crypto.randomUUID()) });
        current = next; setBatch(next);
      }
      setBulk(false); setSelected([]);
    });
  }
  function editRow(id: number, values: Partial<MealImportRow>) {
    setPreview(p => p && { ...p, rows: p.rows.map(r => r.id === id ? { ...r, ...values } : r) });
  }
  function confirmPeriod() {
    setPreview(p => p && {
      ...p,
      rows: p.rows.map(r => r.period_conflict ? {
        ...r, period_confirmed: true,
        correction_reason: r.correction_reason || "已核对年月差异，按所选月份归档",
      } : r),
    });
  }
  const rows = (batch?.items ?? []).filter(i => (!keyword || `${i.emp_no} ${i.name}`.includes(keyword)) &&
    (!department || i.dept_name === department) && (!type || i.is_manager === (type === "manager")) &&
    (!paymentStatus || (paymentStatus === "refund" ? i.difference < 0 : paymentStatus === "settled" ? i.difference === 0 : i.difference > 0)));
  const total = (field: "due_amount" | "paid_amount" | "difference") => rows.reduce((sum, i) => sum + i[field], 0);

  return <main className="meal-ticket-page">
    <header className="meal-ticket-heading"><div><p className="meal-ticket-eyebrow">菜票中心</p><h1>{historical ? "菜票历史台账" : paymentView ? "菜票充值与对账" : "菜票月度核算"}</h1>
      <p>{historical ? "保留历史原账，核对部门登记与考勤试算。" : "实际打卡天数 × 8 元 ＋ 额外补扣，次月充值"}</p></div></header>
    <section className="meal-ticket-toolbar meal-ticket-panel">
      <label>{historical ? "文件月份" : "计划充值月份"}<input type="month" value={month} disabled={busy} onChange={e => setMonth(e.target.value)} /></label>
      {batch && !historical && <span className="meal-ticket-period">考勤月份：{batch.month} · <span className={`meal-ticket-badge ${batch.status === "draft" ? "is-warning" : "is-success"}`}>{batch.status === "draft" ? "草稿" : "已确认"}</span></span>}
      {!historical && admin && <button className="meal-ticket-button" disabled={busy || batch?.status === "confirmed"} onClick={() => mutate("generate", { recharge_month: month })}>生成 / 重算草稿</button>}
      {!historical && admin && batch?.status === "draft" && <button className="meal-ticket-button is-primary" disabled={busy || batch.items.some(i => i.error || i.due_amount < 0)} onClick={() => mutate("confirm")}>确认核算</button>}
      {batch && !historical && <a className="meal-ticket-button meal-ticket-export" href={mealExportUrl(month)}>导出人员及部门报表</a>}
    </section>
    {error && <div role="alert" className="meal-ticket-alert is-error">{error}</div>}
    {busy && <p role="status" className="meal-ticket-loading">正在处理…</p>}
    {batch?.source_changed && <p className="meal-ticket-alert">源考勤或人员资料已变化。草稿请重算；已确认账目请核对后通过额外补扣处理。</p>}
    {!historical && !batch && !busy && <div className="meal-ticket-empty meal-ticket-panel"><h2>本月尚无核算记录</h2><p>该充值月尚无核算记录，请生成对应上月考勤的草稿。</p></div>}
    {!historical && batch && <>
      <section className="meal-ticket-totals" aria-label="金额概览"><div className="meal-ticket-stat is-due"><span>应发金额</span><strong><small>¥</small>{money(total("due_amount"))}</strong><p>基础金额 ＋ 额外补扣</p></div><div className="meal-ticket-stat is-paid"><span>净已发金额</span><strong><small>¥</small>{money(total("paid_amount"))}</strong><p>实际充值扣除退回与冲正</p></div><div className="meal-ticket-stat"><span>差额</span><strong><small>¥</small>{money(total("difference"))}</strong><p>应发金额 − 净已发金额</p></div></section>
      <section className="meal-ticket-panel" aria-label="人员明细"><div className="meal-ticket-section-heading"><div><h2>人员明细</h2><p>按人员核对金额与发放状态</p></div><span className="meal-ticket-count">{rows.length} 人</span></div>
      <div className="meal-ticket-toolbar meal-ticket-filters">
        <label>工号 / 姓名<input placeholder="输入工号或姓名" value={keyword} onChange={e => setKeyword(e.target.value)} /></label>
        <label>核算部门<select value={department} onChange={e => setDepartment(e.target.value)}><option value="">全部部门</option>{batch.departments.map(d => <option key={d.dept_name}>{d.dept_name}</option>)}</select></label>
        <label>人员类型<select value={type} onChange={e => setType(e.target.value)}><option value="">全部人员</option><option value="employee">员工</option><option value="manager">管理人员</option></select></label>
        <label>充值状态<select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}><option value="">全部</option><option value="pending">待发</option><option value="settled">结清</option><option value="refund">待扣回</option></select></label>
        {paymentView && admin && batch.status === "confirmed" && <button className="meal-ticket-button is-primary" disabled={busy || !selected.length} onClick={() => { setBulk(true); setReason(""); requestKeys.current = {}; }}>登记选中人员充值</button>}
      </div>
      <QueryTable headers={["工号","姓名","核算部门","实际打卡天数","基础金额","额外补扣","应发金额","净已发金额","差额","状态 / 操作"]}
        rows={rows.map(i => [i.emp_no, i.name, i.dept_name, i.days, money(i.base_amount), money(i.adjustment_amount), money(i.due_amount), money(i.paid_amount), money(i.difference),
          <div className="meal-ticket-actions"><span className={`meal-ticket-badge ${i.error || i.difference < 0 ? "is-danger" : i.difference === 0 ? "is-success" : "is-warning"}`}>{i.error || (i.difference < 0 ? "待扣回" : i.difference === 0 ? "结清" : i.paid_amount > 0 ? "部分发放" : "未发")}</span>
            <button className="meal-ticket-button is-link" onClick={() => setDetail(i)}>明细</button>{admin && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"adjustments")}>补扣</button>}
            {paymentView && admin && batch.status === "confirmed" && !i.error && <>
              {i.difference > 0 && <><input aria-label={`选择 ${i.emp_no}`} type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(s => e.target.checked ? [...s,i.id] : s.filter(id => id !== i.id))} />
              <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"recharge")}>登记充值</button></>}
              {i.difference < 0 && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"refund")}>登记扣回</button>}
            </>}
          </div>])} />
      </section>
      <section className="meal-ticket-panel" aria-label="部门汇总"><div className="meal-ticket-section-heading"><div><h2>部门汇总</h2><p>由人员明细自动汇总，包含额外补扣。</p></div></div>
      <QueryTable headers={["部门","人数","基础金额","额外补扣","应发金额","净已发金额","差额"]}
        rows={batch.departments.map(d => [<button className="meal-ticket-button is-link" onClick={() => setDepartment(d.dept_name)}>{d.dept_name}</button>,d.count,...[d.base_amount,d.adjustment_amount,d.due_amount,d.paid_amount,d.difference].map(money)])} />
      </section>
    </>}
    {(target || bulk) && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label={bulk ? "批量充值" : action === "adjustments" ? "额外补扣" : "实际发放登记"}>
      <h2>{bulk ? `登记 ${selected.length} 人实际充值` : `${target?.name} · ${action === "adjustments" ? "额外补扣" : action === "reversal" ? "冲正" : "实际发放"}`}</h2>
      <form onSubmit={e => { e.preventDefault(); void (bulk ? saveBulk() : save()); }}>
        {!bulk && action !== "reversal" && <label>{action === "adjustments" ? "调整金额（元）" : "金额（元）"}<input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {(bulk || action !== "adjustments") && <label>实际日期<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>}
        <label>{action === "adjustments" && !bulk ? "调整原因" : "凭证 / 说明"}<textarea required value={reason} onChange={e => setReason(e.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="meal-ticket-actions"><button className="meal-ticket-button is-primary" disabled={busy} type="submit">{action === "adjustments" && !bulk ? "保存补扣" : "确认登记"}</button><button className="meal-ticket-button" type="button" disabled={busy} onClick={() => { setTarget(null); setBulk(false); }}>取消</button></div>
      </form>
    </section></div>}
    {detail && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="菜票明细"><h2>{detail.emp_no} {detail.name}</h2>
      <p>实际打卡天数：{detail.days} · 基础金额：{money(detail.base_amount)} 元</p>
      <p>考勤来源：{detail.source.configured_source} {detail.source.remark}</p>
      <a href={`/employee/individual-attendance?emp_id=${detail.emp_id}&month=${batch?.month}`}>查看考勤依据</a>
      <h3>补扣历史</h3>{detail.adjustments.map(a => <p key={a.id}>{money(a.amount)} 元 · {a.reason} · {a.operator} · {a.created_at}</p>)}
      <h3>充值 / 扣回历史</h3>{detail.payments.map(p => <p key={p.id}>{p.date} · {money(p.amount)} 元 · {p.reference} · {p.operator} {p.reversed && "（已冲正）"}
        {admin && p.kind !== "reversal" && !p.reversed && <button className="meal-ticket-button is-link" onClick={() => { setDetail(null); openForm(detail, "reversal", p.id); }}>冲正</button>}</p>)}
      <button className="meal-ticket-button" onClick={() => setDetail(null)}>关闭</button></section></div>}
    {historical && admin && <>
      <section className="meal-ticket-toolbar meal-ticket-panel"><label>文件月份含义<select value={monthKind} onChange={e => setMonthKind(e.target.value)}><option value="recharge">充值月份</option><option value="attendance">考勤月份</option></select></label>
        <label>历史充值表<input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        <button className="meal-ticket-button is-primary" disabled={busy || !file} onClick={() => operate(async () => {
          const form = new FormData(); form.append("file", file!); form.append("month",month); form.append("month_kind",monthKind);
          setPreview(await previewMealImport(form));
        })}>预览导入</button></section>
      <section className="meal-ticket-panel" aria-label="导入记录"><div className="meal-ticket-section-heading"><div><h2>导入记录</h2><p>原账金额保留。部门登记用于对账，导入不会自动标记实际充值。</p></div></div>
      <QueryTable headers={["文件","考勤月","充值月","状态","人员总额","部门登记总额","操作"]}
        rows={imports.map(r => [r.filename,r.month,r.recharge_month,r.status === "preview" ? "待确认" : "已导入",money(r.person_total),money(r.department_total),<button className="meal-ticket-button is-link" onClick={() => setPreview(r)}>查看</button>])} />
      </section>
      {preview && <section className="meal-ticket-panel meal-ticket-preview"><h2>{preview.filename} · 考勤 {preview.month} / 充值 {preview.recharge_month}</h2>
        <p>人员原账 {money(preview.person_total)} 元 · 部门原账 {money(preview.department_total)} 元</p>
        {preview.status === "preview" && preview.rows.some(r => r.period_conflict && !r.period_confirmed && !r.skip) && <div className="meal-ticket-alert"><p>文件或页内年月与所选月份不一致，请核对上方考勤月和充值月。</p>
          <button className="meal-ticket-button" onClick={confirmPeriod}>已核对年月差异，按所选月份归档</button></div>}
        <QueryTable headers={["页 / 行","类型","原工号 / 姓名","人员映射","部门","金额","核对说明","更正说明","跳过"]}
          rows={preview.rows.map(r => [ `${r.sheet} / ${r.row}`,r.kind === "person" ? "人员" : "部门汇总",`${r.emp_no} ${r.name}`,
            r.kind === "person" ? <select aria-label={`人员映射 ${r.id}`} disabled={preview.status === "confirmed"} value={r.emp_id ?? ""} onChange={e => editRow(r.id,{emp_id:Number(e.target.value) || null})}><option value="">未匹配</option>{people.map(p => <option key={p.id} value={p.id}>{p.emp_no} {p.name}</option>)}</select> : "—",
            <input aria-label={`部门 ${r.id}`} disabled={preview.status === "confirmed"} value={r.dept_name} onChange={e => editRow(r.id,{dept_name:e.target.value})} />,
            <input aria-label={`金额 ${r.id}`} type="number" step="0.01" disabled={preview.status === "confirmed"} value={r.amount ?? ""} onChange={e => editRow(r.id,{amount:e.target.value === "" ? null : Number(e.target.value)})} />,
            [r.error,r.period_conflict].filter(Boolean).join("；"),<input aria-label={`更正说明 ${r.id}`} disabled={preview.status === "confirmed"} value={r.correction_reason} onChange={e => editRow(r.id,{correction_reason:e.target.value})} />,
            <input aria-label={`跳过 ${r.id}`} type="checkbox" disabled={preview.status === "confirmed"} checked={r.skip} onChange={e => editRow(r.id,{skip:e.target.checked})} /> ])} />
        {preview.status === "preview" && <button className="meal-ticket-button is-primary" disabled={busy} onClick={() => operate(async () => { setPreview(await confirmMealImport(preview)); setImports(await fetchMealImports()); })}>确认导入原账</button>}
        <h3>历史部门对账</h3><QueryTable headers={["部门","人员原账合计","部门原登记","差额"]} rows={preview.departments.map(d => [d.dept_name,money(d.person_amount),money(d.historical_amount),money(d.difference)])} />
        <h3>原账与新规则试算</h3><p>按现有考勤字段 × 8 元试算，未包含额外补扣；仅用于核对，不改变原账或生成充值记录。</p>
        <button className="meal-ticket-button is-primary" disabled={busy} onClick={() => operate(async () => setComparison(await compareMealImport(preview.id)))}>读取考勤试算对比</button>
        {comparison.length > 0 && <QueryTable headers={["工号","姓名","原账金额","实际打卡天数","基础试算金额","原账减试算","核对说明"]}
          rows={comparison.map(r => [r.emp_no,r.name,r.historical_amount === null ? "—" : money(r.historical_amount),r.days ?? "—",r.base_amount === null ? "—" : money(r.base_amount),r.difference === null ? "—" : money(r.difference),r.error])} />}
      </section>}
    </>}
  </main>;
}

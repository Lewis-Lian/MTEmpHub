import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchMe } from "../api/auth";
import { apiRequest } from "../api/client";
import { fetchMealBatch, mutateMealBatch, mealExportUrl, fetchMealImports, previewMealImport, confirmMealImport, compareMealImport } from "../api/mealTickets";
import type { MealBatch, MealItem, MealImport, MealImportRow, MealComparison } from "../api/mealTickets";
import QueryTable from "../components/query/QueryTable";
import "./meal-ticket.css";

const money = (n: number) => n.toFixed(2);
const hasError = (item: MealItem) => Boolean(item.error && !item.excluded);
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
  const location = useLocation();
  const lastLocation = useRef(location.key);
  const [admin, setAdmin] = useState(false);
  const [month, setMonth] = useState(() => {
    const requested = new URLSearchParams(location.search).get("recharge_month");
    if (!historical && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "")) return requested!;
    try { return sessionStorage.getItem(`meal-ticket-month-${view}`) || thisMonth(); } catch { return thisMonth(); }
  });
  const [batch, setBatch] = useState<MealBatch | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadProgress, setLoadProgress] = useState<{ completed: number; total: number; text: string; label: string } | null>(null);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [target, setTarget] = useState<MealItem | null>(null);
  const [action, setAction] = useState("adjustments");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [supplementMonth, setSupplementMonth] = useState<string | null>(null);
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
  const personnel = useRef<HTMLElement>(null);
  const settlement = useRef<HTMLElement>(null);
  const participationForm = action === "exclude" || action === "include";
  const participationLabel = action === "exclude" ? "本月不发" : "恢复核算";
  const reasonPresets = action === "exclude" ? ["离职", "工资算菜票"]
    : action === "adjustments" && !bulk ? ["线长补卡", "补x月菜票"] : [];
  const progressPercent = loadProgress && loadProgress.total > 0
    ? Math.round(loadProgress.completed / loadProgress.total * 100) : null;

  useEffect(() => { setComparison([]); }, [preview]);
  useEffect(() => { try { sessionStorage.setItem(`meal-ticket-month-${view}`, month); } catch { /* Session storage may be disabled. */ } }, [month, view]);
  useEffect(() => {
    const id = ++generation.current;
    setBatch(null); setPreview(null); setTarget(null); setDetail(null); setSelected([]); setError("");
    setBusy(true); setAdmin(false); setPeople([]);
    let completed = 0;
    let total = 2;
    let permissionsReady = false;
    const updateProgress = (text: string) => {
      if (id === generation.current) setLoadProgress({ completed, total, text, label: "页面加载进度" });
    };
    updateProgress(historical ? "正在读取账号权限与历史台账" : "正在读取账号权限与月度核算");
    const permissions = fetchMe().then(async user => {
      if (id !== generation.current) return;
      permissionsReady = true;
      setAdmin(user.role === "admin");
      if (historical && user.role === "admin") total = 3;
      completed += 1;
      updateProgress(historical ? "正在读取历史台账与人员名单" : "正在读取月度核算数据");
      if (historical && user.role === "admin") {
        const result = await apiRequest<Array<{ id: number; emp_no: string; name: string }>>("/api/admin/employees?status=all");
        if (id !== generation.current) return;
        setPeople(result); completed += 1;
        updateProgress("人员名单已读取，正在完成历史台账加载");
      }
    });
    const data = (historical ? fetchMealImports().then(result => {
      if (id === generation.current) setImports(result);
    }) : fetchMealBatch(month).then(result => {
      if (id === generation.current) setBatch(result);
    })).then(() => {
      if (id !== generation.current) return;
      completed += 1;
      updateProgress(permissionsReady ? "账目已读取，正在完成页面加载" : "账目已读取，正在检查账号权限");
    });
    Promise.allSettled([permissions, data]).then(results => {
      if (id !== generation.current) return;
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "页面加载失败");
      setBusy(false); setLoadProgress(null);
    });
    return () => { if (id === generation.current) generation.current += 1; };
  }, [month, historical]);

  useEffect(() => {
    if (lastLocation.current === location.key) return;
    if (!historical && location.pathname === `/meal-tickets/${view}` && busy) return;
    lastLocation.current = location.key;
    if (historical || location.pathname !== `/meal-tickets/${view}`) return;
    const requested = new URLSearchParams(location.search).get("recharge_month");
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "") && requested !== month) {
      setMonth(requested!); return;
    }
    let cancelled = false;
    const id = generation.current;
    fetchMealBatch(month).then(next => {
      if (cancelled || id !== generation.current) return;
      setBatch(current => current && next && current.id === next.id && current.version > next.version ? current : next);
    }).catch(e => { if (!cancelled && id === generation.current) setError(e instanceof Error ? e.message : "账目刷新失败"); });
    return () => { cancelled = true; };
  }, [location.key, location.pathname, location.search, month, historical, view, busy]);

  async function operate(task: () => Promise<void>) {
    setBusy(true); setError(""); setLoadProgress(null);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); setLoadProgress(null); }
  }
  async function mutate(endpoint: string, values: object = {}) {
    await operate(async () => {
      const next = await mutateMealBatch(endpoint, { batch_id: batch?.id, version: batch?.version, ...values });
      setBatch(next); setTarget(null);
    });
  }
  function openForm(item: MealItem, endpoint: string, reversal?: number) {
    setTarget(item); setAction(endpoint); setAmount(endpoint === "adjustments" ? "" : money(Math.abs(item.difference)));
    setReason(""); setSupplementMonth(null); setError(""); setReversalId(reversal ?? null); requestKeys.current = { [item.id]: crypto.randomUUID() };
  }
  async function save() {
    if (!target || !batch) return;
    if (!reason.trim()) { setError("请填写原因或说明后再修改"); return; }
    if (participationForm) {
      await mutate("participation", { item_id: target.id, excluded: action === "exclude", reason });
      return;
    }
    const values = { item_id: target.id, amount, reason, kind: action, date, reference: reason,
      reversal_id: reversalId, request_key: requestKeys.current[target.id] };
    await mutate(action === "adjustments" ? action : "payments", values);
  }
  async function saveBulk() {
    if (!batch) return;
    if (!reason.trim()) { setError("请填写原因或说明后再修改"); return; }
    await operate(async () => {
      let current = batch;
      const pending = selected.filter(id => current.items.some(i => i.id === id && i.difference > 0));
      let completed = 0;
      setLoadProgress({ completed, total: pending.length, text: "正在登记选中人员充值", label: "批量充值进度" });
      for (const id of pending) {
        const item = current.items.find(i => i.id === id);
        if (!item || item.difference <= 0) continue;
        const next = await mutateMealBatch("payments", { batch_id: current.id, version: current.version, item_id: id,
          amount: money(item.difference), kind: "recharge", date, reference: reason,
          request_key: requestKeys.current[id] ?? (requestKeys.current[id] = crypto.randomUUID()) });
        current = next; setBatch(next); completed += 1;
        setLoadProgress({ completed, total: pending.length, text: "正在登记选中人员充值", label: "批量充值进度" });
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
    (!paymentStatus || (paymentStatus === "excluded" ? i.excluded && i.due_amount === 0
      : paymentStatus === "refund" ? i.difference < 0 : paymentStatus === "settled" ? i.difference === 0 && !(i.excluded && i.due_amount === 0) : i.difference > 0)));
  const total = (field: "due_amount" | "paid_amount" | "difference") => rows.reduce((sum, i) => sum + i[field], 0);
  const confirmed = batch?.status === "confirmed";
  const pendingCount = batch?.items.filter(i => i.difference > 0).length ?? 0;
  const refundCount = batch?.items.filter(i => i.difference < 0).length ?? 0;
  const errorCount = batch?.items.filter(i => hasError(i) || i.due_amount < 0).length ?? 0;
  const settled = confirmed && pendingCount === 0 && refundCount === 0 && errorCount === 0;
  const showBatch = batch && (!paymentView || confirmed);
  const jumpToPeople = () => personnel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const checkSettlement = () => operate(async () => {
    const next = await fetchMealBatch(month);
    setBatch(next);
    settlement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const steps = paymentView ? [
    { title: "补发 / 扣除", text: "追加调整，填写原因并保留记录。", control: <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={jumpToPeople}>查看人员补扣</button> },
    { title: "登记补发 / 扣回", text: "实际处理成功后，登记对应差额。", control: <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={jumpToPeople}>处理人员差额</button> },
    { title: "再次核对结清", text: "逐人检查剩余差额，补扣后再次核对。", control: <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={checkSettlement}>重新核对</button> },
  ] : [
    { title: "生成草稿", text: "按上月考勤生成本月应发名单。", control: admin && <button className="meal-ticket-button" disabled={busy || confirmed} onClick={() => mutate("generate", { recharge_month: month })}>生成 / 重算草稿</button> },
    { title: "补发 / 扣除", text: "核对人员，调整金额或登记本月不发。", control: <button className="meal-ticket-button" disabled={busy || !batch || confirmed} onClick={jumpToPeople}>核对人员与补扣</button> },
    { title: "确认核算", text: "处理异常后，锁定考勤账套并确认。", control: admin && <button className="meal-ticket-button is-primary" disabled={busy || !batch || confirmed || errorCount > 0} onClick={() => mutate("confirm")}>确认核算</button> },
    { title: "导出充值表", text: "核算完成后导出，按表到充值系统操作。", control: confirmed ? <a className="meal-ticket-button" href={mealExportUrl(month)}>导出人员及部门报表</a> : <button className="meal-ticket-button" disabled>核算后可导出</button> },
    { title: "登记充值", text: "实际充值成功后，登记金额与凭证。", control: <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={jumpToPeople}>登记实际充值</button> },
    { title: "核对结清", text: "按每个人的应发与已发金额检查结清。", control: <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={checkSettlement}>重新核对</button> },
  ];
  const currentStep = paymentView ? settled ? 2 : 0 : !batch ? 0 : !confirmed ? 1 : settled ? 5 : 4;

  return <main className="meal-ticket-page">
    <header className="meal-ticket-heading"><div><p className="meal-ticket-eyebrow">菜票中心</p><h1>{historical ? "菜票历史台账" : paymentView ? "后续补扣与对账" : "月度发放"}</h1>
      <p>{historical ? "保留历史原账，核对部门登记与考勤试算。" : paymentView ? "处理已核算月份的后续补发与扣除，登记实际处理结果后再次核对结清。" : "从生成草稿到充值结清，按顺序完成本月发放。实际打卡天数 × 8 元 ＋ 额外补扣。"}</p></div></header>
    <section className="meal-ticket-toolbar meal-ticket-panel">
      <label>{historical ? "文件月份" : "计划充值月份"}<input type="month" value={month} disabled={busy} onChange={e => setMonth(e.target.value)} /></label>
      {batch && !historical && <span className="meal-ticket-period">考勤月份：{batch.month} · <span className={`meal-ticket-badge ${batch.status === "draft" ? "is-warning" : "is-success"}`}>{batch.status === "draft" ? "草稿" : "已确认"}</span></span>}
      {!historical && confirmed && <Link className="meal-ticket-button meal-ticket-export" to={`/meal-tickets/${paymentView ? "calculation" : "payments"}?recharge_month=${month}`}>{paymentView ? "查看月度发放" : "前往后续补扣与对账"}</Link>}
    </section>
    {!historical && <ol className={`meal-ticket-workflow${paymentView ? " is-followup" : ""}`} aria-label={paymentView ? "后续补扣流程" : "月度发放流程"}>
      {steps.map((step, index) => <li key={step.title} className={index === currentStep ? "is-current" : !paymentView && ((index === 0 && batch) || ((index === 1 || index === 2) && confirmed)) ? "is-complete" : ""} aria-current={index === currentStep ? "step" : undefined}>
        <span className="meal-ticket-step-number">{String(index + 1).padStart(2, "0")}</span><h2>{step.title}</h2><p>{step.text}</p>{step.control}
      </li>)}
    </ol>}
    {error && <div role="alert" className="meal-ticket-alert is-error">{error}</div>}
    {busy && <section role="status" className="meal-ticket-loading meal-ticket-panel" aria-live="polite">
      <div className="meal-ticket-loading-heading"><span><i className="meal-ticket-loading-dot" aria-hidden="true" />{loadProgress?.text ?? "正在提交并等待处理结果"}</span><strong>{progressPercent === null ? "等待响应" : `${progressPercent}%`}</strong></div>
      <div className={`meal-ticket-progress-track${progressPercent === null ? " is-indeterminate" : ""}`} role="progressbar" aria-label={loadProgress?.label ?? "操作进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent ?? undefined}>
        <span style={progressPercent === null ? undefined : { width: `${progressPercent}%` }} />
      </div>
      <p>{loadProgress ? `已完成 ${loadProgress.completed} / ${loadProgress.total} 项请求` : "处理完成后会自动更新账目，请稍候。"}</p>
    </section>}
    {batch?.source_changed && <p className="meal-ticket-alert">源考勤或人员资料已变化。草稿请重算；已确认账目请核对后通过额外补扣处理。</p>}
    {!historical && !busy && (paymentView ? !confirmed : !batch) && <div className="meal-ticket-empty meal-ticket-panel"><h2>{paymentView ? "请先完成月度核算" : "本月尚无核算记录"}</h2><p>{paymentView ? "在月度发放页生成草稿、处理补扣并确认核算后，再处理后续补扣与对账。" : "该充值月尚无核算记录，请从第 1 步生成对应上月考勤的草稿。"}</p>{paymentView && <Link className="meal-ticket-button is-primary" to={`/meal-tickets/calculation?recharge_month=${month}`}>前往月度发放</Link>}</div>}
    {!historical && showBatch && batch && <>
      <section ref={settlement} className={`meal-ticket-settlement meal-ticket-panel${settled ? " is-settled" : ""}`} aria-label="整月结清检查">
        <div><span className="meal-ticket-eyebrow">整月结清检查 · {month}</span><h2>{!confirmed ? "草稿待核算" : settled ? "本月账目已结清" : "还有差额需要处理"}</h2><p>{!confirmed ? "先核对补扣与异常，再确认核算。" : `待充值 ${pendingCount} 人 · 待扣回 ${refundCount} 人 · 异常 ${errorCount} 人`}</p><p>按整月全部人员检查，不受下方筛选影响。结清结果以已登记的实际发放为依据。</p></div>
        {confirmed && !settled && <div className="meal-ticket-actions"><button className="meal-ticket-button" onClick={() => { setKeyword(""); setDepartment(""); setType(""); setPaymentStatus("pending"); jumpToPeople(); }}>查看待充值</button><button className="meal-ticket-button" onClick={() => { setKeyword(""); setDepartment(""); setType(""); setPaymentStatus("refund"); jumpToPeople(); }}>查看待扣回</button></div>}
      </section>
      <section className="meal-ticket-totals" aria-label="金额概览"><div className="meal-ticket-stat is-due"><span>应发金额</span><strong><small>¥</small>{money(total("due_amount"))}</strong><p>基础金额 ＋ 额外补扣</p></div><div className="meal-ticket-stat is-paid"><span>净已发金额</span><strong><small>¥</small>{money(total("paid_amount"))}</strong><p>实际充值扣除退回与冲正</p></div><div className="meal-ticket-stat"><span>差额</span><strong><small>¥</small>{money(total("difference"))}</strong><p>应发金额 − 净已发金额</p></div></section>
      <section ref={personnel} className="meal-ticket-panel" aria-label="人员明细"><div className="meal-ticket-section-heading"><div><h2>人员明细</h2><p>{!confirmed ? "第 2 步：先核对金额，补扣填正数为补发、负数为扣除。" : paymentView ? "追加补扣后，按最新差额登记实际补发或扣回。" : "第 5 步：充值成功后选择人员登记；后续调整请前往补扣与对账页。"}</p></div><span className="meal-ticket-count">{rows.length} 人</span></div>
      <div className="meal-ticket-toolbar meal-ticket-filters">
        <label>工号 / 姓名<input placeholder="输入工号或姓名" value={keyword} onChange={e => setKeyword(e.target.value)} /></label>
        <label>核算部门<select value={department} onChange={e => setDepartment(e.target.value)}><option value="">全部部门</option>{batch.departments.map(d => <option key={d.dept_name}>{d.dept_name}</option>)}</select></label>
        <label>人员类型<select value={type} onChange={e => setType(e.target.value)}><option value="">全部人员</option><option value="employee">员工</option><option value="manager">管理人员</option></select></label>
        <label>充值状态<select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}><option value="">全部</option><option value="pending">待发</option><option value="settled">结清</option><option value="refund">待扣回</option><option value="excluded">本月不发</option></select></label>
        {admin && batch.status === "confirmed" && <button className="meal-ticket-button is-primary" disabled={busy || !selected.length} onClick={() => { setBulk(true); setAction("recharge"); setReason(""); setSupplementMonth(null); requestKeys.current = {}; }}>登记选中人员充值</button>}
      </div>
      <QueryTable headers={["工号","姓名","核算部门","实际打卡天数","基础金额","额外补扣","应发金额","净已发金额","差额","状态 / 操作"]}
        sortRows={rows.map(i => [i.emp_no, i.name, i.dept_name, i.days, i.base_amount, i.adjustment_amount, i.due_amount, i.paid_amount, i.difference,
          hasError(i) || i.due_amount < 0 ? 0 : i.difference < 0 ? 1 : i.excluded && i.due_amount === 0 ? 5 : i.difference === 0 ? 4 : i.paid_amount > 0 ? 3 : 2])}
        rows={rows.map(i => [i.emp_no, i.name, i.dept_name, i.days, money(i.base_amount), money(i.adjustment_amount), money(i.due_amount), money(i.paid_amount), money(i.difference),
          <div className="meal-ticket-actions"><span className={`meal-ticket-badge ${hasError(i) || i.difference < 0 ? "is-danger" : i.difference === 0 ? "is-success" : "is-warning"}`}>{hasError(i) ? i.error : i.difference < 0 ? "待扣回" : i.excluded && i.due_amount === 0 ? "本月不发" : (i.difference === 0 ? "结清" : i.paid_amount > 0 ? "部分发放" : "未发")}</span>
            <button className="meal-ticket-button is-link" onClick={() => setDetail(i)}>明细</button>{admin && (paymentView || batch.status === "draft") && !(batch.status === "draft" && i.excluded) && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"adjustments")}>补扣</button>}
            {admin && batch.status === "draft" && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i, i.excluded ? "include" : "exclude")}>{i.excluded ? "恢复核算" : "本月不发"}</button>}
            {admin && batch.status === "confirmed" && !hasError(i) && <>
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
    {(target || bulk) && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label={bulk ? "批量充值" : participationForm ? "核算处理" : action === "adjustments" ? "额外补扣" : "实际发放登记"}>
      <h2>{bulk ? `登记 ${selected.length} 人实际充值` : `${target?.name} · ${participationForm ? participationLabel : action === "adjustments" ? "额外补扣" : action === "reversal" ? "冲正" : "实际发放"}`}</h2>
      {participationForm && <p>{action === "exclude" ? "本月应发金额按 0 元核算，原考勤和补扣记录保留，缺少考勤来源不再阻止确认。" : "恢复按实际打卡天数和原补扣核算，考勤异常需核对后才能确认。"}</p>}
      <form onSubmit={e => { e.preventDefault(); void (bulk ? saveBulk() : save()); }}>
        {!bulk && !participationForm && action !== "reversal" && <label>{action === "adjustments" ? "调整金额（元）" : "金额（元）"}<input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {!participationForm && (bulk || action !== "adjustments") && <label>实际日期<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>}
        {reasonPresets.length > 0 && <div className="meal-ticket-reason-presets" role="group" aria-label="原因常用语"><span>常用语</span>{reasonPresets.map(phrase => <button className="meal-ticket-button" type="button" disabled={busy} key={phrase} onClick={() => {
          setSupplementMonth(phrase === "补x月菜票" ? "" : null);
          setReason(phrase === "补x月菜票" ? "" : phrase);
        }}>{phrase}</button>)}</div>}
        {supplementMonth !== null && <label>补发月份<select disabled={busy} value={supplementMonth} onChange={e => {
          setSupplementMonth(e.target.value); setReason(e.target.value ? `补${e.target.value}月菜票` : "");
        }}><option value="">请选择月份</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} 月</option>)}</select></label>}
        <label>{participationForm ? "处理原因" : action === "adjustments" && !bulk ? "调整原因" : "凭证 / 说明"}<textarea required maxLength={500} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <p className="meal-ticket-reason-hint">原因或说明必填，常用语可继续编辑。</p>
        {error && <p role="alert">{error}</p>}
        <div className="meal-ticket-actions"><button className="meal-ticket-button is-primary" disabled={busy || !reason.trim()} type="submit">{participationForm ? `确认${participationLabel}` : action === "adjustments" && !bulk ? "保存补扣" : "确认登记"}</button><button className="meal-ticket-button" type="button" disabled={busy} onClick={() => { setTarget(null); setBulk(false); }}>取消</button></div>
      </form>
    </section></div>}
    {detail && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="菜票明细"><h2>{detail.emp_no} {detail.name}</h2>
      <p>实际打卡天数：{detail.days} · 基础金额：{money(detail.base_amount)} 元</p>
      <p>考勤来源：{detail.source.configured_source} {detail.source.remark}</p>
      {detail.error && <p>原考勤核对提示：{detail.error}</p>}
      {detail.excluded && <p>原基础金额：{money(detail.original_base_amount)} 元；本月基础金额按 0 元核算，确认后的补发另记补扣。</p>}
      <Link to={`/employee/individual-attendance?emp_id=${detail.emp_id}&month=${batch?.month}`}>查看考勤依据</Link>
      {!!detail.participation_history?.length && <><h3>核算处理历史</h3>{detail.participation_history.map((p, index) => <p key={index}>{p.excluded ? "本月不发" : "恢复核算"} · {p.reason} · {p.operator} · {p.created_at}</p>)}</>}
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

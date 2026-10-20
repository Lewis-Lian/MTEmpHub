import { useEffect, useRef, useState } from "react";
import { allocateMealFollowup, fetchMealFollowup, progressMealFollowup, refreshMealFollowup } from "../api/mealTickets";
import type { MealFollowupState, MealFollowupTask } from "../api/mealTickets";

const money = (cents: number) => (cents / 100).toFixed(2);
const direction = (task: MealFollowupTask) => task.kind === "refund" ? "取款" : "充值";
const requestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
export default function MealFollowupQueue({ month, batchVersion, refreshRevision, busy, onChanged, onStateChange, onRegister }: {
  month: string; batchVersion: number; refreshRevision: number; busy: boolean;
  onRegister?: (task: MealFollowupTask) => void;
  onChanged: () => void; onStateChange: (state: MealFollowupState) => void;
}) {
  const [state, setState] = useState<MealFollowupState | null>(null);
  const [working, setWorking] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState<MealFollowupTask | null>(null);
  const [reason, setReason] = useState("");
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [baselineValues, setBaselineValues] = useState<Record<string, { recharge: string; refund: string }>>({});
  const [baselineReason, setBaselineReason] = useState("");
  const [link, setLink] = useState<MealFollowupTask | null>(null);
  const [paymentKey, setPaymentKey] = useState("");
  const [linkAmount, setLinkAmount] = useState("");
  const active = useRef(true);
  const loading = useRef(0);
  const locked = useRef(false);
  const revision = useRef(0);
  const attempted = useRef<{ signature: string; body: object } | null>(null);
  const callbacks = useRef({ onChanged, onStateChange });
  callbacks.current = { onChanged, onStateChange };
  function accept(next: MealFollowupState) {
    setState(next); setStale(next.batch_version === null || next.batch_version < batchVersion); setCopied(""); callbacks.current.onStateChange(next);
  }
  useEffect(() => { active.current = true; return () => { active.current = false; loading.current += 1; }; }, []);
  useEffect(() => {
    const id = ++loading.current;
    setStale(true);
    if (busy) return;
    fetchMealFollowup(month).then(async next => {
      if (!active.current || id !== loading.current) return;
      if (refreshRevision > revision.current && !next.baseline_required && !next.settings_changed) {
        next = await refreshMealFollowup({ batch_id: next.batch_id, version: next.batch_version,
          settings_digest: next.settings_digest, request_key: requestKey() });
      }
      if (!active.current || id !== loading.current) return;
      revision.current = refreshRevision; accept(next); setError("");
      if (next.batch_version !== batchVersion && refreshRevision > 0) callbacks.current.onChanged();
    }).catch(err => { if (active.current && id === loading.current) setError(err instanceof Error ? err.message : "读取清单失败，请刷新重试"); });
  }, [month, batchVersion, refreshRevision, busy]);
  const pending = state?.tasks.filter(task => task.status === "pending" || task.status === "skipped") ?? [];
  const awaiting = state?.tasks.filter(task => task.status === "awaiting" || task.status === "partial") ?? [];
  const verified = state?.tasks.filter(task => task.status === "verified") ?? [];
  const filteredPending = pending.filter(task => `${task.emp_no} ${task.name} ${task.dept_name}`.includes(search.trim()));
  const paymentTasks = [...pending, ...awaiting].filter(task => onRegister || task.candidates?.payments.length);
  const current = pending.find(task => task.key === state?.current_task_key) ?? pending[0];
  const currentKey = useRef<string | undefined>(undefined);
  currentKey.current = current?.key;
  const disabled = busy || working || stale || !state || state.settings_changed || state.baseline_required;
  async function copy(value: string, label: string) {
    const key = current?.key;
    setCopied("");
    try { await navigator.clipboard.writeText(value); if (active.current && key === currentKey.current) setCopied(`${label}已复制`); }
    catch { if (active.current && key === currentKey.current) setCopied("复制失败，请重试"); }
  }
  async function write(action: string, task?: MealFollowupTask, retryReason?: string, extra?: object) {
    if (locked.current || (!state && action !== "refresh")) return;
    locked.current = true; setWorking(true); setError(""); setCopied("");
    const id = loading.current;
    try {
      let snapshot = state;
      if (action === "reload") {
        const next = await fetchMealFollowup(month);
        if (active.current && id === loading.current) {
          accept(next); setBaselineOpen(false); callbacks.current.onChanged();
        }
        return;
      }
      if (action === "refresh" && !extra) snapshot = await fetchMealFollowup(month);
      if (!snapshot) return;
      const values = { batch_id: snapshot.batch_id, version: snapshot.batch_version, settings_digest: snapshot.settings_digest,
        ...(task ? { task_version: task.version, action, ...(retryReason ? { reason: retryReason } : {}) } : {}), ...extra };
      const signature = JSON.stringify([task?.key, values]);
      if (attempted.current?.signature !== signature) attempted.current = { signature, body: { ...values, request_key: requestKey() } };
      const next = action === "allocation" && task ? await allocateMealFollowup(task.key, attempted.current!.body)
        : task ? await progressMealFollowup(task.key, attempted.current!.body) : await refreshMealFollowup(attempted.current!.body);
      if (!active.current || id !== loading.current) return;
      attempted.current = null; accept(next); setRetry(null); setLink(null); setBaselineOpen(false); callbacks.current.onChanged();
    } catch (err) {
      if (active.current && id === loading.current) {
        setError(err instanceof Error ? err.message : "保存失败，请重试");
        if (typeof err === "object" && err !== null && "status" in err && err.status === 409) setStale(true);
      }
    } finally { locked.current = false; if (active.current) setWorking(false); }
  }
  return <section className="meal-ticket-panel meal-followup-queue" aria-label="逐人办理">
    <div className="meal-ticket-section-heading">
      <div>
        <h2>逐人办理</h2>
        <p className="meal-followup-description">当前抵消方式：{state?.queue_offset_enabled == null ? "尚未生成清单" : state.queue_offset_enabled ? "补发与扣款按净额抵消" : "补发与扣款分别办理"}。开关在项目更多设置中修改。</p>
      </div>
      <button className="meal-ticket-button meal-followup-refresh-btn" disabled={busy || working || Boolean(state?.baseline_required)} onClick={() => void write("refresh")}>
        <svg className="meal-button-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
        刷新操作清单
      </button>
    </div>
    {state?.settings_changed && <p className="meal-ticket-alert" role="alert">设置已变化，请刷新操作清单</p>}
    {stale && state && !state.settings_changed && <p className="meal-ticket-alert" role="alert">金额或清单已变化，请刷新操作清单后办理。</p>}
    {state?.baseline_required && <p className="meal-ticket-alert" role="alert">{state.baseline_reason}</p>}
    {state?.baseline_required && stale && <button className="meal-ticket-button" disabled={busy || working} onClick={() => void write("reload")}>重新读取核对基线</button>}
    {!!state?.baseline_items?.length && <button className="meal-ticket-button" disabled={busy || working || stale} onClick={() => {
      setBaselineValues(Object.fromEntries(state.baseline_items!.map(item => [item.item_key,
        { recharge: money(Math.max(item.difference_cents, 0)), refund: money(Math.max(-item.difference_cents, 0)) }])));
      setBaselineReason(""); setBaselineOpen(true);
    }}>确认旧月剩余基线</button>}
    {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
    {!state && <p>正在读取服务端操作清单。</p>}
    <div className="meal-followup-workspace">
      <section className="meal-followup-card" aria-label="当前办理任务">
        <div className="meal-followup-block-heading">
          <div className="meal-followup-heading-title">
            <span className="meal-followup-indicator-dot" aria-hidden="true" />
            <h3>当前办理</h3>
          </div>
          <span className="meal-ticket-badge is-primary">待办理 {pending.length} 项</span>
        </div>
        {current ? <>
          <div className="meal-followup-person">
            <div className="meal-followup-avatar" aria-hidden="true">
              {current.name.charAt(0)}
            </div>
            <div className="meal-followup-person-meta">
              <strong>{current.name}</strong>
              <span className="meal-followup-dept-chip">{current.dept_name}</span>
            </div>
          </div>
          <div className="meal-ticket-actions meal-followup-emp-row">
            <span className="meal-followup-employee-number">工号 {current.emp_no}</span>
            <button className="meal-ticket-button is-link meal-followup-copy-chip" disabled={disabled} onClick={() => void copy(current.emp_no, "工号")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              复制工号
            </button>
          </div>
          <div className={`meal-followup-amount${current.kind === "refund" ? " is-refund" : ""}`}>
            <div className="meal-followup-amount-content">
              <span className="meal-followup-amount-label">{current.kind === "refund" ? "待取款扣回" : "待充值发放"}</span>
              <strong>{direction(current)} {money(current.remaining_cents)} 元</strong>
            </div>
            <button className="meal-ticket-button meal-followup-amount-copy" disabled={disabled} onClick={() => void copy(money(current.remaining_cents), "金额")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              复制金额
            </button>
          </div>
          <p className="meal-followup-copy-status" role="status">
            {copied && <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> {copied}</>}
          </p>
          <div className="meal-ticket-actions meal-followup-current-actions">
            <button className="meal-ticket-button meal-followup-btn-skip" disabled={disabled || current.status === "skipped"} onClick={() => void write("skip", current)}>暂时跳过</button>
            <button className="meal-ticket-button is-primary meal-followup-btn-complete" disabled={disabled} onClick={() => void write("complete", current)}>
              <span>已完成{direction(current)}，下一人</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </> : <p className="meal-followup-empty">{state?.baseline_required ? "需核对后生成清单。" : state ? "当前没有待操作项；以实际流水核对结果为准。" : "正在读取当前任务。"}</p>}
        <div className="meal-followup-progress">
          <div className="meal-followup-progress-header">
            <strong>本轮已操作 {awaiting.length + verified.length} / {pending.length + awaiting.length + verified.length} 项</strong>
            <span className="meal-followup-progress-pill">
              {pending.length + awaiting.length + verified.length > 0 ? Math.round(((awaiting.length + verified.length) / (pending.length + awaiting.length + verified.length)) * 100) : 0}%
            </span>
          </div>
          <div className="meal-followup-progress-bar" aria-hidden="true">
            <span className="meal-followup-progress-fill" style={{ width: `${pending.length + awaiting.length + verified.length > 0 ? ((awaiting.length + verified.length) / (pending.length + awaiting.length + verified.length)) * 100 : 0}%` }} />
          </div>
          <p>完成按钮仅保存外部操作声明，不登记实际到账。流水可能延迟，请先核对，勿据此再次充值或取款。</p>
        </div>
      </section>
      <section className="meal-followup-block" aria-label="办理名单">
        <div className="meal-followup-block-heading">
          <div className="meal-followup-heading-title">
            <h3>办理名单</h3>
          </div>
          <span className="meal-ticket-badge">{filteredPending.length} 项</span>
        </div>
        <label className="meal-followup-search">
          <span className="meal-followup-search-label">搜索办理任务</span>
          <div className="meal-followup-search-wrapper">
            <svg className="meal-followup-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="工号 / 姓名 / 部门" />
          </div>
        </label>
        <ul className="meal-followup-task-list">{filteredPending.map(task => <li key={task.key}><button className="meal-followup-task" disabled={disabled} aria-pressed={task.key === currentKey.current} onClick={() => void write("select", task)}>
          <span className="meal-followup-task-person">
            <strong>{task.name}</strong>
            <small>{task.emp_no} · {task.dept_name}</small>
          </span>
          <span className={`meal-followup-task-amount${task.kind === "refund" ? " is-refund" : ""}`}>
            <span className="meal-followup-task-amount-tag">{direction(task)} {money(task.remaining_cents)} 元</span>
            {task.status === "skipped" && <small className="meal-followup-skipped-tag">暂时跳过</small>}
          </span>
        </button></li>)}</ul>
        {!filteredPending.length && <p className="meal-followup-empty">{search.trim() ? "没有匹配的办理任务" : "暂无待办理任务"}</p>}
      </section>
    </div>
    <div className="meal-followup-review-grid">
      <section className="meal-followup-block meal-followup-review-block" aria-label="待核对任务">
        <div className="meal-followup-block-heading">
          <h3>待核对任务</h3>
          <span className="meal-ticket-badge is-warning">{awaiting.length} 项</span>
        </div>
        <ul className="meal-followup-review-list">{awaiting.map(task => <li key={task.key} className="meal-followup-review-item">
          <div className="meal-followup-review-item-header">
            <div className="meal-followup-review-user">
              <strong>{task.emp_no} {task.name}</strong>
              <span className={`meal-ticket-badge ${task.status === "partial" ? "is-info" : "is-warning"}`}>
                {task.status === "partial" ? "部分到账" : "待核对"}
              </span>
            </div>
            <span className={`meal-followup-direction-chip ${task.kind === "refund" ? "is-refund" : ""}`}>
              {direction(task)}
            </span>
          </div>
          <p className="meal-followup-review-details">{task.emp_no} {task.name} · {direction(task)} · {task.status === "partial" ? "部分到账" : "待核对"} · 已匹配 {money(task.allocated_cents)} 元 · 剩余 {money(task.remaining_cents)} 元</p>
          <div className="meal-ticket-actions meal-followup-review-actions">
            {task.status === "awaiting" && task.allocated_cents === 0 && <button className="meal-ticket-button is-link" disabled={busy || working || stale} onClick={() => void write("undo", task)}>未实际操作，撤销标记</button>}
            <button className="meal-ticket-button" disabled={busy || working || stale} onClick={() => { setRetry(task); setReason(""); }}>确认尚未到账，重新办理</button>
          </div>
        </li>)}</ul>
        {!awaiting.length && <p className="meal-followup-empty">暂无待核对任务</p>}
      </section>
      <section className="meal-followup-block meal-followup-review-block" aria-label="实际流水核对">
        <div className="meal-followup-block-heading">
          <h3>实际流水核对</h3>
          <span className="meal-ticket-badge">{paymentTasks.length} 项</span>
        </div>
        <div className="meal-followup-review-list">{paymentTasks.map(task => <div className="meal-followup-payment" key={task.key}>
          <div className="meal-followup-payment-header">
            <p className="meal-followup-payment-person"><strong>{task.name}</strong><span>{task.emp_no} · {direction(task)}</span></p>
            {onRegister && <button className="meal-ticket-button is-primary" disabled={busy || working || stale || (pending.includes(task) && disabled)} onClick={() => onRegister(task)}>登记实际{direction(task)} · {task.emp_no}</button>}
          </div>
          {!!task.candidates?.payments.length && <div className="meal-followup-payment-candidates">
            <p>{task.emp_no} {task.name} · 待确认实际流水关联；请逐笔核实人员、方向及凭证，关联不会新建支付。</p>
            <button className="meal-ticket-button" disabled={busy || working || stale} onClick={() => {
              setLink(task); setPaymentKey(""); setLinkAmount("");
            }}>关联实际流水 · {task.emp_no} {direction(task)}</button>
          </div>}
        </div>)}</div>
        {!paymentTasks.length && <p className="meal-followup-empty">暂无需要关联的实际流水</p>}
      </section>
    </div>
    {baselineOpen && state && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="确认旧月剩余基线" className="meal-ticket-operation-dialog meal-followup-dialog meal-followup-baseline-dialog" aria-busy={working}>
      <header className="meal-ticket-operation-heading"><span className="meal-ticket-operation-eyebrow">历史月份核对</span><h2>确认旧月剩余基线</h2><p>先核对全部实际流水，再确认每人的剩余金额。</p></header>
      <form onSubmit={e => {
        e.preventDefault();
        const baselines = Object.fromEntries((state.baseline_items ?? []).map(item => [item.item_key, {
          recharge_cents: Math.round(Number(baselineValues[item.item_key]?.recharge) * 100),
          refund_cents: Math.round(Number(baselineValues[item.item_key]?.refund) * 100), reason: baselineReason.trim(),
        }]));
        void write("refresh", undefined, undefined, { baselines });
      }}>
        <div className="meal-followup-dialog-body">
          <p className="meal-followup-notice">默认仅列已证实净差额，历史补扣不自动重发。分别办理时，请核实待充值、待取款两个方向的剩余金额，并填写依据。</p>
          <div className="meal-followup-table-heading"><strong>人员剩余金额</strong><span>{state.baseline_items?.length ?? 0} 人 · 单位：元</span></div>
          <div className="meal-followup-table-scroll" role="region" aria-label="基线人员金额" tabIndex={0}>
            <table className="meal-followup-baseline-table">
              <thead><tr><th scope="col">工号</th><th scope="col">姓名</th><th scope="col">应发</th><th scope="col">净已发</th><th scope="col">待充值</th><th scope="col">待取款</th></tr></thead>
              <tbody>{state.baseline_items?.map(item => <tr key={item.item_key}>
                <td>{item.emp_no}</td><th scope="row">{item.name}</th><td>{money(item.due_cents)}</td><td>{money(item.paid_cents)}</td>
                {(["recharge", "refund"] as const).map(kind => <td key={kind}><input aria-label={`${item.emp_no} ${kind === "recharge" ? "待充值" : "待取款"}（元）`} type="number" required min="0" step="0.01" disabled={working}
                  value={baselineValues[item.item_key]?.[kind] ?? ""} onChange={e => setBaselineValues(values => ({ ...values, [item.item_key]: { ...values[item.item_key], [kind]: e.target.value } }))} /></td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <label>基线核实说明<textarea required maxLength={500} placeholder="填写核对依据及剩余金额的确认情况" disabled={working} value={baselineReason} onChange={e => setBaselineReason(e.target.value)} /></label>
          {error && <p className="meal-ticket-alert is-error" role="alert">{error}</p>}
        </div>
        <footer className="meal-followup-dialog-footer"><button type="button" className="meal-ticket-button" disabled={working} onClick={() => setBaselineOpen(false)}>取消</button><button className="meal-ticket-button is-primary" disabled={busy || working || stale || !baselineReason.trim()}>核实并生成清单</button></footer>
      </form>
    </section></div>}
    {link && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="关联实际流水" className="meal-ticket-operation-dialog meal-followup-dialog" aria-busy={working}>
      <header className="meal-ticket-operation-heading"><span className="meal-ticket-operation-eyebrow">实际流水核对</span><h2>关联实际流水</h2><p>{link.emp_no} {link.name} · {direction(link)} · 剩余 {money(link.remaining_cents)} 元</p></header>
      <form onSubmit={e => { e.preventDefault(); void write("allocation", link, undefined, { payment_key: paymentKey, amount_cents: Math.round(Number(linkAmount) * 100) }); }}>
        <div className="meal-followup-dialog-body"><p className="meal-followup-notice">请核实流水的人员、方向及凭证。关联已有流水不会新建支付。</p>
        <label>实际流水<select required disabled={working} value={paymentKey} onChange={e => {
          setPaymentKey(e.target.value);
          const candidate = link.candidates?.payments.find(payment => payment.payment_key === e.target.value);
          setLinkAmount(candidate ? money(Math.min(candidate.available_cents, link.remaining_cents)) : "");
        }}><option value="">请选择已核实流水</option>{link.candidates?.payments.map(payment => <option key={payment.payment_key} value={payment.payment_key}>{payment.date} · 可用 {money(payment.available_cents)} 元 · {payment.reference}</option>)}</select></label>
        <label>关联金额（元）<input required type="number" step="0.01" min="0.01" max={money(Math.min(link.remaining_cents, link.candidates?.payments.find(payment => payment.payment_key === paymentKey)?.available_cents ?? 0))}
          disabled={working} value={linkAmount} onChange={e => setLinkAmount(e.target.value)} /></label>
        {error && <p className="meal-ticket-alert is-error" role="alert">{error}</p>}</div>
        <footer className="meal-followup-dialog-footer"><button type="button" className="meal-ticket-button" disabled={working} onClick={() => setLink(null)}>取消</button><button className="meal-ticket-button is-primary" disabled={busy || working || stale || !paymentKey || Number(linkAmount) <= 0}>确认关联</button></footer>
      </form>
    </section></div>}
    {!!verified.length && <details className="meal-followup-verified"><summary>已核对 {verified.length} 项</summary><ul>{verified.map(task => <li key={task.key}>{task.emp_no} {task.name} · {direction(task)} {money(task.allocated_cents)} 元 · 已核对</li>)}</ul></details>}
    {retry && <div className="meal-ticket-modal"><section className="meal-ticket-operation-dialog meal-followup-dialog" role="dialog" aria-modal="true" aria-label="确认重新办理" aria-busy={working}>
      <header className="meal-ticket-operation-heading"><span className="meal-ticket-operation-eyebrow">重新办理</span><h2>确认重新办理</h2><p>{retry.emp_no} {retry.name} · {direction(retry)} · 剩余 {money(retry.remaining_cents)} 元</p></header>
      <div className="meal-followup-dialog-body"><p className="meal-followup-notice">流水可能延迟。请确认尚未到账后，仅重新办理剩余 {money(retry.remaining_cents)} 元；本操作不会冲正或删除真实流水。</p>
      <label>重新办理原因<textarea required disabled={working} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      {error && <p className="meal-ticket-alert is-error" role="alert">{error}</p>}</div>
      <footer className="meal-followup-dialog-footer"><button className="meal-ticket-button" disabled={working} onClick={() => setRetry(null)}>取消</button><button className="meal-ticket-button is-primary" disabled={busy || working || stale || !reason.trim()} onClick={() => void write("retry", retry, reason.trim())}>确认重新办理</button></footer>
    </section></div>}
  </section>;
}

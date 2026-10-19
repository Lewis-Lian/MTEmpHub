import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  checkGuestRecharge, createGuestCard, money, updateGuestCard,
  type GuestCard, type GuestRechargeCandidate, type LedgerRecord,
} from "../../api/mealLedgers";
import "./guest-card-tools.css";

export function GuestCardRegistry({ cards, onChanged }: {
  cards: GuestCard[]; onChanged: () => Promise<void> | void;
}) {
  const [identity, setIdentity] = useState({ card_no: "", emp_no: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(action: () => Promise<unknown>, clear = false) {
    setBusy(true); setError("");
    try {
      await action();
      if (clear) setIdentity({ card_no: "", emp_no: "", name: "" });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "客人卡保存失败");
    } finally { setBusy(false); }
  }
  return <details className="guest-card-registry">
    <summary><span>客人卡管理</span><small>{cards.filter(card => card.is_active).length} 张可用</small></summary>
    <p>维护可重复借用的固定卡片账户。卡号、数据库人员编号和卡片名称新增后不可修改。</p>
    <form className="guest-card-form" onSubmit={event => {
      event.preventDefault();
      if (!busy) void save(() => createGuestCard({
        card_no: identity.card_no.trim(), emp_no: identity.emp_no.trim(), name: identity.name.trim(),
      }), true);
    }}>
      {([['card_no', '客人卡号'], ['emp_no', '数据库人员编号'], ['name', '客人卡名称']] as const).map(([key, label]) =>
        <label key={key}>{label}<input className="form-control" required disabled={busy} value={identity[key]}
          onChange={event => setIdentity({ ...identity, [key]: event.target.value })} /></label>)}
      <button className="meal-ticket-button is-primary" disabled={busy || Object.values(identity).some(value => !value.trim())}>新增客人卡</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="guest-card-table-scroll"><table className="guest-card-table"><thead><tr>
      <th>卡号</th><th>数据库编号</th><th>卡片名称</th><th>状态</th><th>操作</th>
    </tr></thead><tbody>{cards.map(card => <tr key={card.key}>
      <td>{card.card_no}</td><td>{card.emp_no}</td><td>{card.name}</td><td><span className={`meal-external-state is-${card.is_active ? "complete" : "voided"}`}>{card.is_active ? "启用" : "停用"}</span></td>
      <td><button type="button" className="meal-ticket-button" disabled={busy} aria-label={`${card.is_active ? "停用" : "启用"} ${card.name}`}
        onClick={() => void save(() => updateGuestCard(card.key, !card.is_active))}>{card.is_active ? "停用" : "启用"}</button></td>
    </tr>)}</tbody></table></div>
    {cards.length === 0 && <p>暂无客人卡</p>}
  </details>;
}

export function GuestRechargeDialog({ record, onClose, onUpdated }: {
  record: LedgerRecord; onClose: () => void; onUpdated: (record: LedgerRecord) => void;
}) {
  const [current, setCurrent] = useState(record);
  const startDate = `${record.month}-01`;
  const [endDate, setEndDate] = useState(record.date);
  const [candidates, setCandidates] = useState<GuestRechargeCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'input, button',
      ) ?? []).filter(control => !control.hasAttribute("disabled"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus(); };
  }, []);
  async function query(confirm = false) {
    if (busy) return;
    setBusy(true); setError(""); setCandidates(null);
    const keys = confirm ? selected : undefined;
    setSelected([]);
    try {
      const result = await checkGuestRecharge(record.id, endDate, keys);
      setCurrent(result.record); setCandidates(result.candidates); onUpdated(result.record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "充值查询失败，请重试");
    } finally { setBusy(false); }
  }
  const status = { manual: "手工登记", pending: "未充值", partial: "部分到账", complete: "已到账" };
  return createPortal(<div className="guest-recharge-backdrop"><section ref={dialog}
    className="guest-recharge-dialog" role="dialog" aria-modal="true" aria-label="客人卡充值核对" aria-busy={busy}>
    <header className="meal-external-dialog-header">
      <div><h2>客人卡充值核对</h2><p>{current.name} · {current.dept_name || "承担部门未填写"}</p></div>
      <span className={`meal-external-state is-${current.recharge_status ?? "pending"}`}>{status[current.recharge_status ?? "pending"]}</span>
    </header>
    <div className="meal-external-dialog-body">
    <div className="guest-recharge-account"><span>卡号 <b>{current.card_no}</b></span><span>数据库编号 <b>{current.emp_no}</b></span></div>
    <div className="guest-recharge-summary">
      <div aria-label="预计金额"><span>预计金额</span><strong>{money(current.amount)}<small>元</small></strong></div>
      <div aria-label="实际充值"><span>实际充值</span><strong>{money(current.actual_amount ?? 0)}<small>元</small></strong></div>
    </div>
    <section className="guest-recharge-query-section" aria-label="充值查询范围"><h3>查询实际充值</h3>
    <p>查询起始日期：{startDate}</p>
    <div className="guest-recharge-query"><label>查询截止日期<input type="date" className="form-control" value={endDate}
      min={startDate} disabled={busy} onChange={event => {
        setEndDate(event.target.value); setCandidates(null); setSelected([]); setError("");
      }} /></label>
      <button className="meal-ticket-button is-primary" disabled={busy || !endDate || endDate < startDate} onClick={() => void query()}>查询充值</button></div>
    <p className="guest-recharge-hint">可延长截止日期查询延迟到账的充值，勾选后确认计入本次发放。</p>
    </section>
    {error && <p role="alert" className="guest-recharge-error">{error}</p>}
    {busy && <p role="status">正在查询充值…</p>}
    {candidates === null && !busy && !error && <div className="guest-recharge-empty">查询后，在这里选择本次领用对应的充值流水。</div>}
    {candidates && <div className="guest-card-table-scroll"><table className="guest-card-table"><thead><tr>
      <th>选择</th><th>来源流水</th><th>充值日期</th><th>金额</th><th>状态</th>
    </tr></thead><tbody>{candidates.map(candidate => <tr key={candidate.source_key}>
      <td><input type="checkbox" aria-label={`选择充值 ${candidate.source_key}`} disabled={busy || candidate.matched || candidate.occupied}
        checked={candidate.matched || selected.includes(candidate.source_key)} onChange={event => setSelected(event.target.checked
          ? [...selected, candidate.source_key] : selected.filter(key => key !== candidate.source_key))} /></td>
      <td className="guest-recharge-source" title={candidate.source_key}>{candidate.source_key}</td>
      <td>{candidate.date.replace("T", " ")}</td><td>{money(candidate.amount)}</td>
      <td><span className={`meal-external-state is-${candidate.matched ? "complete" : candidate.occupied ? "voided" : "pending"}`}>{candidate.matched ? "已计入本记录" : candidate.occupied ? "已被其他记录占用" : "可选"}</span></td>
    </tr>)}</tbody></table>{candidates.length === 0 && <p>该日期范围内暂无充值流水</p>}</div>}
    </div>
    <footer className="meal-external-dialog-footer guest-recharge-actions">
      <span>已选 {selected.length} 笔 · {money((candidates ?? []).filter(row => selected.includes(row.source_key)).reduce((sum, row) => sum + row.amount, 0))} 元</span>
      <div><button className="meal-ticket-button" onClick={onClose}>关闭</button><button className="meal-ticket-button is-primary" disabled={busy || selected.length === 0}
        onClick={() => void query(true)}>确认选中充值</button></div>
    </footer>
  </section></div>, document.body);
}

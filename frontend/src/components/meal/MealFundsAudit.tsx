import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { LedgerBookIcon, SearchIcon } from "../icons";
import "./meal-funds-audit.css";
import { auditMealFunds, type MealFundsAudit as Audit } from "../../api/mealTickets";

const sources: Record<string, string> = { subsidy:"补贴发放", recharge:"充值", refund:"取款", unlinked:"未关联来源" };
const statuses: Record<string, string> = { unassigned:"待归属", unlinked:"登记未关联数据库流水",
  duplicate:"重复归属", changed:"流水或登记内容变化", missing:"数据库原流水缺失", invalid:"登记已作废或归属无效" };
const money = (value: number) => (value / 100).toFixed(2);

type Props = { month: string; revision: string; disabled: boolean };

export default function MealFundsAudit(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="meal-ticket-button" disabled={props.disabled} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>核对全部资金</button>
    {open && <FundsAuditDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}

function FundsAuditDialog({ month, revision, disabled, onClose }: Props & { onClose: () => void }) {
  const [start, setStart] = useState(`${month}-01`);
  const [end, setEnd] = useState(`${month}-${String(new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()).padStart(2,"0")}`);
  const [result, setResult] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'input, button, a[href]',
      ) ?? []).filter(control => !control.hasAttribute("disabled"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    generation.current += 1;
    setResult(null); setError(""); setLoading(false);
    return () => { generation.current += 1; };
  }, [start, end, revision]);

  async function check() {
    const id = ++generation.current;
    setResult(null); setError(""); setLoading(true);
    try {
      const next = await auditMealFunds(start, end);
      if (generation.current === id) setResult(next);
    } catch (e) {
      if (generation.current === id) setError(e instanceof Error ? e.message : "全部资金核对失败");
    } finally {
      if (generation.current === id) setLoading(false);
    }
  }

  const state = loading ? "loading" : error ? "error" : result ? result.complete ? "complete" : "issues" : "idle";
  const statusText = loading ? "正在核对全部资金" : error ? "全部资金核对失败" : result
    ? result.complete ? "全部资金已核清" : "存在待归属或异常流水" : "全部资金待核对";

  return createPortal(<div className="meal-ticket-modal" onClick={event => {
    if (event.target === event.currentTarget) onClose();
  }}><section ref={dialog} className="meal-funds-audit-dialog"
    role="dialog" aria-modal="true" aria-label="全部资金核对" aria-busy={loading}>
    <header className="funds-audit-header">
      <div className="funds-audit-heading"><span className="funds-audit-mark" aria-hidden="true"><LedgerBookIcon /></span>
        <div><h2>全部资金核对</h2><p>补贴、充值与取款，覆盖全部人员和卡片</p></div>
      </div>
      <button className="meal-ticket-button" onClick={onClose}>关闭</button>
    </header>
    <div className="funds-audit-body">
      <div className="funds-audit-query">
        <label>资金核对开始日期<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <span className="funds-audit-range-separator" aria-hidden="true">至</span>
        <label>资金核对结束日期<input type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
        <button className="meal-ticket-button is-primary" disabled={disabled || loading || !start || !end || end < start}
          onClick={() => void check()}>{loading ? "核对中…" : "开始核对"}</button>
        <span className="funds-audit-query-note">按实际流水逐笔比对归属</span>
      </div>
      <div className="funds-audit-status" data-state={state} role="status">
        <strong><span className="funds-audit-status-dot" aria-hidden="true" />{statusText}</strong>
        {result && <span>{result.start_date} 至 {result.end_date} · 核对于 {result.checked_at.replace("T", " ")}</span>}
      </div>
      {error && <p role="alert" className="funds-audit-error">{error}</p>}
      {!result && !error && <div className="funds-audit-empty">
        <span aria-hidden="true"><SearchIcon /></span>
        <h3>{loading ? "正在读取并比对资金流水" : "选择日期范围，开始资金核对"}</h3>
        <p>核对后展示分类金额、归属差额及需要处理的流水。</p>
      </div>}
      {result && <>
        <dl className="funds-audit-totals" role="group" aria-label="资金金额摘要">
          <div><dt>数据库净额</dt><dd className="funds-audit-total-value"><small>¥</small><span>{money(result.database_net_cents)}</span></dd><dd className="funds-audit-total-caption">补贴＋充值－取款</dd></div>
          <div><dt>项目净额</dt><dd className="funds-audit-total-value"><small>¥</small><span>{money(result.recorded_net_cents)}</span></dd><dd className="funds-audit-total-caption">员工、客人及清零登记</dd></div>
          <div data-different={result.database_net_cents !== result.recorded_net_cents}><dt>净额差额</dt>
            <dd className="funds-audit-total-value"><small>¥</small><span>{money(result.database_net_cents - result.recorded_net_cents)}</span></dd><dd className="funds-audit-total-caption">数据库净额－项目净额</dd></div>
        </dl>
        <section className="funds-audit-section" aria-label="资金分类">
          <div className="funds-audit-section-heading"><h3>资金分类汇总</h3><span>金额单位：元</span></div>
          <div className="funds-audit-table-wrap"><table className="funds-audit-table" aria-label="资金分类汇总">
            <thead><tr><th>类别</th><th>数据库笔数</th><th>数据库金额</th><th>项目登记金额</th><th>员工发放 / 扣回</th><th>客人领用</th><th>清零</th><th>差额</th></tr></thead>
            <tbody>{result.sources.map(row => <tr key={row.source}><td>{sources[row.source] ?? row.source}</td>
              <td>{row.database_count}</td><td>{money(row.database_cents)}</td><td>{money(row.recorded_cents)}</td>
              <td>{money(row.employee_cents)}</td><td>{money(row.guest_cents)}</td><td>{money(row.clearance_cents)}</td>
              <td data-different={row.database_cents !== row.recorded_cents}>{money(row.database_cents - row.recorded_cents)}</td></tr>)}</tbody>
          </table></div>
        </section>
        {result.issues.length > 0 && <section className="funds-audit-section" aria-label="待处理资金">
          <div className="funds-audit-section-heading"><h3>待归属与异常流水</h3><span className="funds-audit-count">{result.issues.length} 条待处理</span></div>
          <div className="funds-audit-table-wrap"><table className="funds-audit-table funds-audit-issues" aria-label="待归属与异常流水">
            <thead><tr><th>日期</th><th>类别</th><th>流水号</th><th>人员编号</th><th>数据库金额</th><th>项目登记金额</th><th>问题</th></tr></thead>
            <tbody>{result.issues.map((row, index) => <tr key={row.source_key ?? index}><td>{row.date}</td>
              <td>{sources[row.source] ?? row.source}</td><td>{row.source_key?.split(":").slice(-1)[0] ?? "—"}</td>
              <td>{row.emp_no || "未匹配人员"}</td><td>{money(row.amount_cents)}</td><td>{money(row.recorded_cents)}</td>
              <td><span className="funds-audit-issue-tag">{statuses[row.status] ?? row.status}</span></td></tr>)}</tbody>
          </table></div>
          <p className="funds-audit-help">员工补入及补扣在本页办理；客人领用请<Link to="/meal-tickets/external">登记并匹配充值</Link>；取款请核实扣回或<Link to="/meal-tickets/clearance">月末清零</Link>用途。核查处理后重新核对。</p>
        </section>}
      </>}
    </div>
    <footer className="funds-audit-footer"><span>只读核对，不自动入账</span>
      <span>员工结清与全部资金核清分别判断；后续新增流水需重新核对。</span></footer>
  </section></div>, document.body);
}

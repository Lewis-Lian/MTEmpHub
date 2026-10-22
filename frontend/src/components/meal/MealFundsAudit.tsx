import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { auditMealFunds, type MealFundsAudit as Audit } from "../../api/mealTickets";

const sources: Record<string, string> = { subsidy:"补贴发放", recharge:"充值", refund:"取款", unlinked:"未关联来源" };
const statuses: Record<string, string> = { unassigned:"待归属", unlinked:"登记未关联数据库流水",
  duplicate:"重复归属", changed:"流水或登记内容变化", missing:"数据库原流水缺失", invalid:"登记已作废或归属无效" };
const money = (value: number) => (value / 100).toFixed(2);

export default function MealFundsAudit({ month, revision, disabled }: { month: string; revision: string; disabled: boolean }) {
  const [start, setStart] = useState(`${month}-01`);
  const [end, setEnd] = useState(`${month}-${String(new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()).padStart(2,"0")}`);
  const [result, setResult] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
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

  return <section className="meal-ticket-panel meal-ticket-reconciliation" aria-label="全部资金核对" aria-busy={loading}>
    <div className="meal-ticket-section-heading"><div><h2>全部资金核对</h2>
      <p>覆盖范围内全部人员和卡的补贴、充值、取款；逐笔核查员工发放、客人领用及清零归属。</p></div></div>
    <div className="meal-ticket-reconciliation-controls">
      <label>资金核对开始日期<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>资金核对结束日期<input type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
      <button className="meal-ticket-button is-primary" disabled={disabled || loading || !start || !end || end < start}
        onClick={() => void check()}>{loading ? "核对中…" : "核对全部资金"}</button>
    </div>
    <div className="meal-ticket-reconciliation-result" role="status">
      <strong>{loading ? "正在核对全部资金" : error ? "全部资金核对失败" : result
        ? result.complete ? "全部资金已核清" : "存在待归属或异常流水" : "全部资金待核对"}</strong>
      {result && <span>范围 {result.start_date} 至 {result.end_date} · 核对时间 {result.checked_at.replace("T", " ")}</span>}
    </div>
    {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
    <p className="meal-ticket-reconciliation-note">员工结清只检查本批次应发与实发。全部资金核清还要求每笔流水有且仅有一个有效归属，且内容、分类金额和总金额一致。结果以本次核对时间为准，后续新增流水需重新核对。</p>
    {result && <>
      <div className="meal-ticket-refund-table-wrap"><table className="meal-ticket-refund-table" aria-label="资金分类汇总">
        <thead><tr><th>类别</th><th>数据库笔数</th><th>数据库金额</th><th>项目登记金额</th><th>员工发放 / 扣回</th><th>客人领用</th><th>清零</th><th>差额</th></tr></thead>
        <tbody>{result.sources.map(row => <tr key={row.source}><td>{sources[row.source] ?? row.source}</td>
          <td>{row.database_count}</td><td>{money(row.database_cents)}</td><td>{money(row.recorded_cents)}</td>
          <td>{money(row.employee_cents)}</td><td>{money(row.guest_cents)}</td><td>{money(row.clearance_cents)}</td>
          <td>{money(row.database_cents - row.recorded_cents)}</td></tr>)}</tbody>
      </table></div>
      <p className="meal-ticket-reconciliation-note">补贴＋充值－取款：数据库净额 {money(result.database_net_cents)} 元 · 项目净额 {money(result.recorded_net_cents)} 元 · 差额 {money(result.database_net_cents - result.recorded_net_cents)} 元</p>
      {result.issues.length > 0 && <>
        <h3>待归属与异常流水（{result.issues.length} 条）</h3>
        <div className="meal-ticket-refund-table-wrap"><table className="meal-ticket-refund-table" aria-label="待归属与异常流水">
          <thead><tr><th>日期</th><th>类别</th><th>流水号</th><th>人员编号</th><th>数据库金额</th><th>项目登记金额</th><th>问题</th></tr></thead>
          <tbody>{result.issues.map((row, index) => <tr key={row.source_key ?? index}><td>{row.date}</td>
            <td>{sources[row.source] ?? row.source}</td><td>{row.source_key?.split(":").slice(-1)[0] ?? "—"}</td>
            <td>{row.emp_no || "未匹配人员"}</td><td>{money(row.amount_cents)}</td><td>{money(row.recorded_cents)}</td>
            <td>{statuses[row.status] ?? row.status}</td></tr>)}</tbody>
        </table></div>
        <p className="meal-ticket-reconciliation-note">员工补入及补扣在本页办理；客人领用请先<Link to="/meal-tickets/external">登记并匹配充值</Link>；取款请核实扣回或<Link to="/meal-tickets/clearance">月末清零</Link>用途。重复、变化或缺失的流水须核查原始记录，再重新核对。</p>
      </>}
    </>}
  </section>;
}

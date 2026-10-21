import { useEffect, useRef, useState } from "react";
import { confirmClearance, money, previewClearance, type ClearancePreview, type ClearanceResult } from "../../api/mealLedgers";
import QueryTable from "../query/QueryTable";

export type ClearanceStage = "query" | "confirm" | "ledger";
const labels = { available:"可确认清零", registered:"已登记清零", refunded:"已计入补扣扣回", manual_conflict:"已有同人员同金额记录，需核对", voided:"清零记录已作废" };
export default function MealClearanceImport({ month, stage, onStageChange, busy, onBusyChange, onImported }: {
  month: string; stage: ClearanceStage; onStageChange: (stage: ClearanceStage) => void;
  busy: boolean; onBusyChange: (busy: boolean) => void; onImported: () => Promise<void>;
}) {
  const [start, setStart] = useState(`${month}-01`);
  const last = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`;
  const [end, setEnd] = useState(last);
  const [preview, setPreview] = useState<ClearancePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ClearanceResult | null>(null);
  const [error, setError] = useState("");
  const active = useRef(true);
  const working = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function run(confirm: boolean) {
    if (busy || working.current) return;
    working.current = true; onBusyChange(true); setError("");
    try {
      if (confirm && preview) {
        const next = await confirmClearance({ month, start_date:preview.start_date, end_date:preview.end_date,
          source_digest:preview.source_digest, source_keys:selected });
        if (!active.current) return;
        await onImported();
        if (!active.current) return;
        setResult(next); setSelected([]); onStageChange("ledger");
      } else {
        const next = await previewClearance({ month, start_date:start, end_date:end });
        if (!active.current) return;
        setPreview(next); setSelected([]); setResult(null); onStageChange("confirm");
      }
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : "取款核对失败，请重试");
    } finally {
      working.current = false;
      if (active.current) onBusyChange(false);
    }
  }
  const available = preview?.rows.filter(row => row.status === "available") ?? [];
  return <section className="meal-ticket-panel" aria-label="数据库清零入账">
    <ol className="meal-ticket-workflow" aria-label="月末取款入账流程">
      {[{id:"query",title:"查询取款流水"},{id:"confirm",title:"确认清零记录"},{id:"ledger",title:"入账与台账"}].map((step, index) =>
        <li key={step.id} className={stage === step.id ? "is-current" : ""} aria-current={stage === step.id ? "step" : undefined}>
          <div className="meal-ticket-step-heading"><span className="meal-ticket-step-number">{index + 1}</span><h2>{step.title}</h2></div>
        </li>)}
    </ol>
    {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
    {stage === "query" && <>
      <p>查询真实取款流水，确认属于月末余额清零后入账；补扣扣回不能重复登记为清零。</p>
      <div className="meal-ticket-toolbar">
        <label>查询开始日期<input type="date" min={`${month}-01`} max={end} value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
        <label>查询结束日期<input type="date" min={start} max={last} value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
        <button className="meal-ticket-button is-primary" disabled={busy || !start || !end || end < start} onClick={() => void run(false)}>查询取款流水</button>
        <button className="meal-ticket-button" disabled={busy} onClick={() => onStageChange("ledger")}>查看已有台账</button>
      </div>
    </>}
    {stage === "confirm" && preview && <>
      <p>仅勾选已核实为月末清零的取款。已登记、已扣回、已作废及疑似重复记录不可选。</p>
      <QueryTable headers={[{ label:<input aria-label="全选可入账流水" type="checkbox" disabled={busy || !available.length}
        checked={available.length > 0 && selected.length === available.length}
        onChange={event => setSelected(event.target.checked ? available.map(row => row.source_key) : [])} />, sortable:false },
        "取款时间", "人员编号", "姓名", "部门", "卡号", "金额（元）", "状态"]}
        rows={preview.rows.map(row => [<input type="checkbox" aria-label={`选择清零流水 ${row.source_key}`}
          checked={selected.includes(row.source_key)} disabled={busy || row.status !== "available"}
          onChange={event => setSelected(keys => event.target.checked ? [...keys, row.source_key] : keys.filter(key => key !== row.source_key))} />,
          row.date.replace("T", " "), row.emp_no, row.name, row.dept_name || "—", row.card_no || "—", money(row.amount), labels[row.status]])} />
      <p>已选 {selected.length} 笔 · {money(preview.rows.filter(row => selected.includes(row.source_key)).reduce((sum, row) => sum + row.amount, 0))} 元</p>
      <div className="meal-ticket-actions">
        <button className="meal-ticket-button" disabled={busy} onClick={() => { setSelected([]); setError(""); onStageChange("query"); }}>返回查询</button>
        <button className="meal-ticket-button is-primary" disabled={busy || !selected.length} onClick={() => void run(true)}>确认清零并入账</button>
        <button className="meal-ticket-button" disabled={busy} onClick={() => onStageChange("ledger")}>查看已有台账</button>
      </div>
    </>}
    {stage === "ledger" && <>
      {result && <p role="status">新增 {result.added} 笔清零记录，已登记 {result.existing} 笔；已更新本月台账。</p>}
      <button className="meal-ticket-button" disabled={busy} onClick={() => { setPreview(null); setSelected([]); setError(""); onStageChange("query"); }}>重新查询取款</button>
    </>}
    {busy && <p role="status">正在读取并核验取款流水，请稍候…</p>}
  </section>;
}

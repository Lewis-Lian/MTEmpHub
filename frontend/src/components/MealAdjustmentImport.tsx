import { useEffect, useRef, useState } from "react";
import { confirmMealAdjustmentImport, mealAdjustmentTemplateUrl, previewMealAdjustmentImport } from "../api/mealTickets";
import type { MealAdjustmentPreview, MealBatch } from "../api/mealTickets";
import QueryTable from "./query/QueryTable";

export default function MealAdjustmentImport({ batch, busy, onBusyChange, onImported }: {
  batch: MealBatch; busy: boolean; onBusyChange: (busy: boolean) => void; onImported: (batch: MealBatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MealAdjustmentPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const disabled = busy || working;

  async function run(task: () => Promise<void>) {
    setWorking(true); setError(""); onBusyChange(true);
    try { await task(); }
    catch (err) { if (active.current) setError(err instanceof Error ? err.message : "补扣导入失败"); }
    finally { if (active.current) { setWorking(false); onBusyChange(false); } }
  }
  function close() { setOpen(false); setFile(null); setPreview(null); setError(""); }
  function upload() {
    if (!file) return;
    void run(async () => {
      const result = await previewMealAdjustmentImport(batch, file);
      if (active.current) setPreview(result);
    });
  }
  function apply() {
    if (!preview || preview.error_count) return;
    void run(async () => {
      const result = await confirmMealAdjustmentImport(preview.token);
      if (active.current) { onImported(result); close(); }
    });
  }

  return <>
    <section className="meal-ticket-export-toolbar" aria-label="批量导入补扣">
      <div className="meal-ticket-export-summary"><strong>批量导入补扣</strong><p>按工号导入 Excel 清单，正数补发、负数扣除。</p></div>
      <div className="meal-ticket-actions">
        <a className="meal-ticket-button" href={mealAdjustmentTemplateUrl()}>下载补扣模板</a>
        <button className="meal-ticket-button is-primary" disabled={disabled} onClick={() => setOpen(true)}>导入补扣清单</button>
      </div>
    </section>
    {open && <div className="meal-ticket-modal"><section className="meal-ticket-operation-dialog" role="dialog" aria-modal="true" aria-label="批量导入补扣" aria-busy={working}>
      <header className="meal-ticket-operation-heading"><h2>批量导入补扣</h2><p>充值月份：{batch.recharge_month} · 只登记应发补扣，实际充值流水保留。</p></header>
      <label>补扣 Excel 文件<input type="file" accept=".xlsx" disabled={disabled} onChange={event => {
        setFile(event.target.files?.[0] ?? null); setPreview(null); setError("");
      }} /></label>
      <p>每人一行，工号和姓名须与本月核算名单一致，原因必填。金额最多两位小数，不能使用公式。</p>
      {error && <p className="meal-ticket-alert is-error" role="alert">{error}</p>}
      {working && <p role="status">正在处理补扣清单...</p>}
      {preview && <>
        <p>{preview.filename} · {preview.rows.length} 人 · 合计调整 {preview.total_amount.toFixed(2)} 元 · 错误 {preview.error_count} 行</p>
        {!!preview.error_count && <p className="meal-ticket-alert is-error">请修正 Excel 中的问题后重新上传，当前清单不会入账。</p>}
        <QueryTable headers={["行号", "工号", "姓名", "核算部门", "调整金额", "原因", "校验结果"]}
          rows={preview.rows.map(row => [row.row, row.emp_no, row.name, row.dept_name,
            row.amount == null ? "—" : row.amount.toFixed(2), row.reason, row.error || "通过"])} />
      </>}
      <div className="meal-ticket-actions">
        <button className="meal-ticket-button" disabled={disabled || !file} onClick={upload}>预览导入</button>
        {preview && <button className="meal-ticket-button is-primary" disabled={disabled || preview.error_count > 0} onClick={apply}>确认导入补扣</button>}
        <button className="meal-ticket-button" disabled={disabled} onClick={close}>取消</button>
      </div>
    </section></div>}
  </>;
}

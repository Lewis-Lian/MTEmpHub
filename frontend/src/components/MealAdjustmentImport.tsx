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
  const [isToolbarDragOver, setIsToolbarDragOver] = useState(false);
  const [isModalDragOver, setIsModalDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const disabled = busy || working;

  async function run(task: () => Promise<void>) {
    setWorking(true); setError(""); onBusyChange(true);
    try { await task(); }
    catch (err) { if (active.current) setError(err instanceof Error ? err.message : "补扣导入失败"); }
    finally { if (active.current) { setWorking(false); onBusyChange(false); } }
  }
  function close() { setOpen(false); setFile(null); setPreview(null); setError(""); setIsModalDragOver(false); }
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

  function handleFileDrop(dropped: File | null) {
    if (!dropped) return;
    setFile(dropped);
    setPreview(null);
    setError("");
  }

  return <>
    <section
      className={`meal-ticket-export-toolbar meal-followup-import-toolbar${isToolbarDragOver ? " is-dragover" : ""}`}
      aria-label="批量导入补扣"
      onDragOver={event => {
        event.preventDefault();
        if (!disabled) setIsToolbarDragOver(true);
      }}
      onDragLeave={event => {
        event.preventDefault();
        setIsToolbarDragOver(false);
      }}
      onDrop={event => {
        event.preventDefault();
        setIsToolbarDragOver(false);
        if (disabled) return;
        const droppedFile = event.dataTransfer.files?.[0];
        if (droppedFile) {
          handleFileDrop(droppedFile);
          setOpen(true);
        }
      }}
    >
      <div className="meal-ticket-export-summary">
        <div className="meal-followup-import-text">
          <strong>批量导入补扣</strong>
          <p>{isToolbarDragOver ? "松开鼠标以导入此 Excel 文件" : "按工号导入 Excel 清单，正数补发、负数扣除。支持直接拖入文件。"}</p>
        </div>
      </div>
      <div className="meal-ticket-actions">
        <a className="meal-ticket-button" href={mealAdjustmentTemplateUrl()}>下载补扣模板</a>
        <button className="meal-ticket-button is-primary" disabled={disabled} onClick={() => setOpen(true)}>导入补扣清单</button>
      </div>
    </section>
    {open && <div className="meal-ticket-modal"><section className="meal-ticket-operation-dialog" role="dialog" aria-modal="true" aria-label="批量导入补扣" aria-busy={working}>
      <header className="meal-ticket-operation-heading"><h2>批量导入补扣</h2><p>充值月份：{batch.recharge_month} · 只登记应发补扣，实际充值流水保留。</p></header>
      <div className="meal-adjustment-upload-field">
        <label htmlFor="meal-adjustment-file-input" className="meal-adjustment-file-label-text">补扣 Excel 文件</label>
        <div
          className={`meal-adjustment-dropzone${isModalDragOver ? " is-dragover" : ""}${file ? " has-file" : ""}`}
          onClick={() => { if (!disabled) fileInputRef.current?.click(); }}
          onDragOver={event => {
            event.preventDefault();
            if (!disabled) setIsModalDragOver(true);
          }}
          onDragLeave={event => {
            event.preventDefault();
            setIsModalDragOver(false);
          }}
          onDrop={event => {
            event.preventDefault();
            setIsModalDragOver(false);
            if (disabled) return;
            const droppedFile = event.dataTransfer.files?.[0];
            if (droppedFile) handleFileDrop(droppedFile);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={event => {
            if ((event.key === "Enter" || event.key === " ") && !disabled) {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          aria-label="拖拽区域：点击选择或将 Excel 文件拖入此处"
        >
          <svg className="meal-adjustment-dropzone-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          <div className="meal-adjustment-dropzone-text">
            {file ? (
              <>
                <strong className="meal-adjustment-file-name">{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB · 点击或重新拖入更换文件</span>
              </>
            ) : (
              <>
                <strong>点击选择，或将 Excel 文件拖入到这里</strong>
                <span>支持 .xlsx 格式文件</span>
              </>
            )}
          </div>
          <input
            id="meal-adjustment-file-input"
            ref={fileInputRef}
            className="meal-adjustment-hidden-input"
            type="file"
            accept=".xlsx"
            disabled={disabled}
            onChange={event => {
              handleFileDrop(event.target.files?.[0] ?? null);
            }}
          />
        </div>
      </div>
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

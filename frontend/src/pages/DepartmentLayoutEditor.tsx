import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../api/client";
import "./department-layout.css";

type Side = "left" | "right";
interface Layout { left: string[]; right: string[]; unassigned: string[] }
const endpoint = "/api/meal-ledgers/department-layout";

export default function DepartmentLayoutEditor({ rechargeMonth, initiallyOpen = false, onClose }: {
  rechargeMonth: string; initiallyOpen?: boolean; onClose?: () => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  savingRef.current = saving;
  const [year, month] = rechargeMonth.split("-").map(Number);
  const attendanceYear = month === 1 ? year - 1 : year;
  const attendanceMonth = month === 1 ? 12 : month - 1;

  useEffect(() => {
    if (!onClose) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!savingRef.current) onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); opener?.focus(); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    apiRequest<Layout>(endpoint).then(value => { if (active) setLayout(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "排版读取失败"); });
    return () => { active = false; };
  }, []);

  const move = (name: string, side: Side, before?: string) => {
    if (!layout || saving || before === name) return;
    const next = {
      left: layout.left.filter(value => value !== name),
      right: layout.right.filter(value => value !== name),
      unassigned: layout.unassigned.filter(value => value !== name),
    };
    const index = before ? next[side].indexOf(before) : -1;
    next[side].splice(index < 0 ? next[side].length : index, 0, name);
    setLayout(next); setMessage("");
  };

  const keyboardMove = (event: React.KeyboardEvent, name: string, side?: Side) => {
    if (!layout) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); move(name, event.key === "ArrowLeft" ? "left" : "right");
    } else if (side && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const index = layout[side].indexOf(name);
      if (event.key === "ArrowUp" && index > 0) move(name, side, layout[side][index - 1]);
      if (event.key === "ArrowDown" && index < layout[side].length - 1) move(name, side, layout[side][index + 2]);
    }
  };

  const startDrag = (event: React.DragEvent, name: string) => {
    event.dataTransfer.setData("text/plain", name);
    event.dataTransfer.effectAllowed = "move";
  };
  const drop = (event: React.DragEvent, side: Side, before?: string) => {
    event.preventDefault(); event.stopPropagation();
    const name = event.dataTransfer.getData("text/plain");
    if (layout && [...layout.left, ...layout.right, ...layout.unassigned].includes(name)) move(name, side, before);
  };
  const save = async () => {
    if (!layout) return;
    setSaving(true); setError(""); setMessage("");
    try {
      setLayout(await apiRequest<Layout>(endpoint, { method: "PUT", body: { left: layout.left, right: layout.right } }));
      setMessage("排版已保存，后续下载沿用此排列。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const content = <>
    <p>拖动部门可调整顺序或移到另一侧；选中部门后，也可用方向键移动。客人充卡和纸质菜票固定放在右侧部门下方。</p>
    <p>充值月份 {rechargeMonth} · 表头采用考勤月份 {attendanceYear}-{String(attendanceMonth).padStart(2, "0")}，保持 A4 竖向。</p>
    {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
    {!layout ? <p>正在读取排版…</p> : <>
      {layout.unassigned.length > 0 && <div className="department-layout-unassigned">
        <strong>待安排的部门</strong><p>拖到下方左侧或右侧。尚未安排的部门下载时暂列在右侧末尾。</p>
        {layout.unassigned.map(name => <button key={name} type="button" draggable={!saving}
          onDragStart={event => startDrag(event, name)} onKeyDown={event => keyboardMove(event, name)} disabled={saving}>{name}</button>)}
      </div>}
      <div className="department-layout-scroll"><div className="department-layout-paper">
        <h3>{attendanceYear}年{attendanceMonth}月份菜票登记</h3>
        <div className="department-layout-columns">
          {(["left", "right"] as const).map(side => <table key={side} aria-label={side === "left" ? "左侧部门" : "右侧部门"}
            onDragOver={event => event.preventDefault()} onDrop={event => drop(event, side)}>
            <colgroup><col className="department-layout-name" /><col /><col /></colgroup>
            <thead><tr><th>部门</th><th>金额</th><th>备注</th></tr></thead>
            <tbody>{layout[side].map(name => <tr key={name} draggable={!saving} tabIndex={saving ? -1 : 0}
              aria-label={name} onKeyDown={event => keyboardMove(event, name, side)}
              onDragStart={event => startDrag(event, name)} onDragOver={event => event.preventDefault()}
              onDrop={event => drop(event, side, name)}><td>{name}</td><td>—</td><td /></tr>)}
              <tr className="department-layout-placeholder"><td colSpan={3}>{side === "left" ? "拖到此处追加左侧部门" : "拖到此处追加右侧部门"}</td></tr>
              {side === "right" && <tr className="department-layout-guests"><td>客人-部门</td><td>—</td><td /></tr>}
            </tbody>
          </table>)}
        </div>
        <div className="department-layout-total">合计：<span>—</span></div>
      </div></div>
    </>}
  </>;
  const actions = <div className="department-layout-actions">
    {message && <span role="status">{message}</span>}
    {onClose && <button type="button" className="meal-ticket-button" disabled={saving} onClick={onClose}>完成</button>}
    <button type="button" className="meal-ticket-button is-primary" disabled={saving || !layout} onClick={save}>{saving ? "保存中…" : "保存排版"}</button>
  </div>;
  if (onClose) return createPortal(<div className="department-layout-backdrop"><section ref={dialog} role="dialog"
    aria-modal="true" aria-label="部门排版设置" className="meal-ticket-page meal-ledger-page department-layout-dialog" aria-busy={saving}>
    <header className="department-layout-dialog-header"><div><span>下载设置 · A4 打印</span><h2>部门排版设置</h2></div>
      <button type="button" className="department-layout-close" aria-label="关闭排版设置" disabled={saving} onClick={onClose}>×</button></header>
    <div className="department-layout-dialog-body department-layout-editor">{content}</div>
    <footer className="department-layout-dialog-footer">{actions}</footer>
  </section></div>, document.body);
  return <details open={initiallyOpen} className="meal-ticket-panel department-layout-editor"><summary>部门排版设置</summary>{content}{actions}</details>;
}

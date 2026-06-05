import { FormEvent, useEffect, useState } from "react";

import { createAdminShift, deleteAdminShift, fetchAdminShifts, updateAdminShift } from "../../api/admin";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import type { AdminShift } from "../../types/admin";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
import { useNotification } from "../../components/feedback/Notification";



type ShiftFormState = {
  shift_no: string;
  shift_name: string;
  is_cross_day: boolean;
  time_slots: string[][];
};

const emptyShiftForm: ShiftFormState = {
  shift_no: "",
  shift_name: "",
  is_cross_day: false,
  time_slots: [["", ""]],
};

function validateShiftSlots(timeSlots: string[][]): string[][] {
  const normalized = timeSlots
    .map(([start, end]) => [start.trim(), end.trim()] as [string, string])
    .filter(([start, end]) => start || end);

  if (!normalized.length) {
    throw new Error("请至少保留一个时间段");
  }

  for (const [start, end] of normalized) {
    if (!start || !end) {
      throw new Error("请完整填写每个时间段");
    }
  }

  return normalized;
}

function normalizeSlots(value: AdminShift["time_slots"]): string[][] {
  if (!Array.isArray(value) || value.length === 0) {
    return [["", ""]];
  }
  return value.map((slot) => {
    if (Array.isArray(slot)) {
      return [String(slot[0] ?? ""), String(slot[1] ?? "")];
    }
    return [String(slot.start ?? slot.start_time ?? ""), String(slot.end ?? slot.end_time ?? "")];
  });
}

function formatSlots(value: AdminShift["time_slots"]) {
  const slots = normalizeSlots(value).filter(([start, end]) => start || end);
  return slots.length ? slots.map(([start, end]) => `${start || "-"}-${end || "-"}`).join("；") : "-";
}

function shiftToForm(shift: AdminShift): ShiftFormState {
  return {
    shift_no: shift.shift_no,
    shift_name: shift.shift_name,
    is_cross_day: Boolean(shift.is_cross_day),
    time_slots: normalizeSlots(shift.time_slots),
  };
}

export default function ShiftsPage() {
  const confirm = useConfirm();
  const notification = useNotification();
  const [rows, setRows] = useState<AdminShift[]>([]);
  const [form, setForm] = useState<ShiftFormState>(emptyShiftForm);
  const [editing, setEditing] = useState<AdminShift | null>(null);
  const [editForm, setEditForm] = useState<ShiftFormState>(emptyShiftForm);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<"create" | null>(null);

  const handleCloseModal = () => {
    setShowModal(null);
  };

  async function loadRows() {
    setLoading(true);
    try {
      setRows(await fetchAdminShifts());
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "班次列表加载失败");
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    void loadRows();
  }, []);

  function updateSlot(target: "create" | "edit", index: number, side: 0 | 1, value: string) {
    const setter = target === "create" ? setForm : setEditForm;
    setter((current) => ({
      ...current,
      time_slots: current.time_slots.map((slot, slotIndex) =>
        slotIndex === index ? [side === 0 ? value : slot[0], side === 1 ? value : slot[1]] : slot,
      ),
    }));
  }

  function addSlot(target: "create" | "edit") {
    const setter = target === "create" ? setForm : setEditForm;
    setter((current) => ({ ...current, time_slots: [...current.time_slots, ["", ""]] }));
  }

  function removeSlot(target: "create" | "edit", index: number) {
    const setter = target === "create" ? setForm : setEditForm;
    setter((current) => ({
      ...current,
      time_slots: current.time_slots.length > 1 ? current.time_slots.filter((_, slotIndex) => slotIndex !== index) : current.time_slots,
    }));
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    try {
      const timeSlots = validateShiftSlots(form.time_slots);
      await createAdminShift({
        ...form,
        time_slots: timeSlots,
      });
      setForm(emptyShiftForm);
      notification.success(`班次 ${form.shift_name} 已创建`);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "创建班次失败");
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    try {
      const timeSlots = validateShiftSlots(editForm.time_slots);
      await updateAdminShift(editing.id, {
        ...editForm,
        time_slots: timeSlots,
      });
      setEditing(null);
      notification.success(`班次 ${editForm.shift_name} 已保存`);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "保存班次失败");
    }
  }

  async function removeShift(row: AdminShift) {
    const isConfirmed = await confirm({
      message: `确定删除班次 ${row.shift_no} - ${row.shift_name}？`,
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await deleteAdminShift(row.id);
      notification.success(`班次 ${row.shift_name} 已删除`);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "删除班次失败");
    }
  }



  function openEdit(row: AdminShift) {
    setEditing(row);
    setEditForm(shiftToForm(row));
  }

  function renderSlotEditor(target: "create" | "edit", state: ShiftFormState) {
    return (
      <div className="master-slot-list">
        {state.time_slots.map((slot, index) => (
          <div className="master-slot-row" key={index}>
            <input
              className="account-input"
              type="time"
              onChange={(event) => updateSlot(target, index, 0, event.target.value)}
              value={slot[0]}
            />
            <input
              className="account-input"
              type="time"
              onChange={(event) => updateSlot(target, index, 1, event.target.value)}
              value={slot[1]}
            />
            <button className="account-action-button account-action-button--danger master-slot-remove" onClick={() => removeSlot(target, index)} type="button">
              删
            </button>
          </div>
        ))}
      </div>
    );
  }

  const shiftTableHeaders = [
    "ID",
    "班次编号",
    "班次名称",
    "时间段",
    "跨天",
    { label: "操作", sortable: false },
  ];

  const shiftTableRows = loading
    ? []
    : rows.map((row) => [
        row.id,
        row.shift_no,
        row.shift_name,
        formatSlots(row.time_slots),
        row.is_cross_day ? "是" : "否",
        <div className="toolbar">
          <button className="account-action-button" onClick={() => openEdit(row)} type="button">编辑</button>
          <button className="account-action-button account-action-button--danger" onClick={() => removeShift(row)} type="button">删除</button>
        </div>,
      ]);

  const shiftTableSortRows = loading
    ? []
    : rows.map((row) => [
        row.id,
        row.shift_no,
        row.shift_name,
        formatSlots(row.time_slots),
        row.is_cross_day ? "是" : "否",
        "",
      ]);

  return (
    <main className="master-data-page shifts-master-page">
      {/* 顶部控制与摘要行 */}
      <div className="account-top-control-row" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
        marginBottom: "16px",
        marginTop: "16px"
      }}>
        {/* 左侧控制按钮组 */}
        <div className="account-panel-selector" style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn btn-outline-secondary"
            onClick={() => setShowModal("create")}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新建班次
          </button>
        </div>

        {/* 右侧信息摘要状态条 */}
        <div className="active-account-set-summary-bar" style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          minHeight: "36px",
          boxSizing: "border-box",
          padding: "0 16px",
          background: "var(--ent-secondary-bg, #f8fafc)",
          border: "1px solid var(--ent-border-strong)",
          borderRadius: "var(--ent-radius-lg, 8px)",
          fontSize: "13.5px",
          color: "var(--ent-text)",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.02)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--ent-text-secondary)", fontWeight: "500" }}>班次总数：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.length} 个</strong>
          </div>
          <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--ent-text-secondary)" }}>跨天班次：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.filter(r => r.is_cross_day).length} 个</strong>
          </div>
        </div>
      </div>

      <div className="account-card-header master-list-header" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 4px",
        borderBottom: "none",
        background: "transparent",
        flexWrap: "wrap",
        gap: "12px"
      }}>
        <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)" }}>班次列表</span>
        <div className="toolbar" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button className="account-action-button" onClick={loadRows} type="button">
            刷新
          </button>
        </div>
      </div>

      <QueryResultPanel>
        {loading ? (
          <div className="legacy-table-panel master-table-panel">
            <div className="legacy-table-wrap">
              <table className="legacy-table master-table">
                <tbody>
                  <tr><td className="legacy-table-empty-cell">正在加载班次列表...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <QueryTable
            emptyText="暂无班次数据"
            headers={shiftTableHeaders}
            panelClassName="master-table-panel"
            rows={shiftTableRows}
            sortRows={shiftTableSortRows}
            tableClassName="master-table"
          />
        )}
      </QueryResultPanel>

      {/* 新增班次 Modal 弹窗 */}
      <div className="master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }} style={{
        position: "fixed",
        left: showModal === "create" ? "0" : "-9999px",
        top: "0",
        width: "100%",
        height: "100%",
        zIndex: 1500,
        background: "rgba(15, 23, 42, 0.3)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        boxSizing: "border-box",
        opacity: showModal === "create" ? 1 : 0,
        pointerEvents: showModal === "create" ? "auto" : "none",
        transition: "opacity 0.15s ease"
      }}>
        <div className="master-modal-container" style={{ width: "100%", maxWidth: "500px", background: "#fff", borderRadius: "12px", padding: "24px", boxSizing: "border-box", position: "relative" }}>
          <button className="master-modal-close" onClick={handleCloseModal} style={{ position: "absolute", top: "16px", right: "16px", border: "none", background: "transparent", fontSize: "20px", cursor: "pointer", color: "#64748b" }} type="button">×</button>
          <div style={{ borderBottom: "1px solid var(--ent-border)", paddingBottom: "12px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)" }}>新增班次</span>
            <span className="page-tag">排班规则</span>
          </div>
          <form className="account-create-form" onSubmit={submitCreate}>
            <label className="account-field">
              <span className="account-field-label">班次编号</span>
              <input className="account-input" onChange={(event) => setForm({ ...form, shift_no: event.target.value })} required value={form.shift_no} />
            </label>
            <label className="account-field">
              <span className="account-field-label">班次名称</span>
              <input className="account-input" onChange={(event) => setForm({ ...form, shift_name: event.target.value })} required value={form.shift_name} />
            </label>
            <label className="master-check-option" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "16px" }}>
              <input checked={form.is_cross_day} onChange={(event) => setForm({ ...form, is_cross_day: event.target.checked })} type="checkbox" />
              <span>跨天班次</span>
            </label>
            <div className="account-field">
              <div className="master-field-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span className="account-field-label" style={{ marginBottom: 0 }}>班次时间段</span>
                <button className="account-action-button" onClick={() => addSlot("create")} type="button">
                  新增时间段
                </button>
              </div>
              {renderSlotEditor("create", form)}
            </div>
            <button className="account-action-button account-action-button--primary account-primary-button" type="submit" style={{ width: "100%", marginTop: "16px" }}>
              创建班次
            </button>
          </form>
        </div>
      </div>

      {editing ? (
        <div className="master-modal-backdrop">
          <form className="master-modal" onSubmit={submitEdit}>
            <div className="master-modal-header">
              <h2>编辑班次</h2>
              <button className="master-modal-close" onClick={() => setEditing(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <label className="account-field">
                <span className="account-field-label">班次编号</span>
                <input className="account-input" onChange={(event) => setEditForm({ ...editForm, shift_no: event.target.value })} required value={editForm.shift_no} />
              </label>
              <label className="account-field">
                <span className="account-field-label">班次名称</span>
                <input className="account-input" onChange={(event) => setEditForm({ ...editForm, shift_name: event.target.value })} required value={editForm.shift_name} />
              </label>
              <label className="master-check-option">
                <input checked={editForm.is_cross_day} onChange={(event) => setEditForm({ ...editForm, is_cross_day: event.target.checked })} type="checkbox" />
                <span>跨天班次</span>
              </label>
              <div className="account-field">
                <div className="master-field-head">
                  <span className="account-field-label">班次时间段</span>
                  <button className="account-action-button" onClick={() => addSlot("edit")} type="button">新增时间段</button>
                </div>
                {renderSlotEditor("edit", editForm)}
              </div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}


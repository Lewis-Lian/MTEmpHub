import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { createAdminShift, deleteAdminShift, fetchAdminShifts, updateAdminShift } from "../../api/admin";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import type { AdminShift } from "../../types/admin";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
import { useNotification } from "../../components/feedback/Notification";
import TimePicker from "../../components/common/TimePicker";
import "./shift-management.css";

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

function ShiftRowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function toggleOpen(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!open) {
      const rect = e.currentTarget.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 140),
      });
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className="shift-row-actions" style={{ position: "relative" }}>
      <div className="shift-row-action-group">
        <button className="shift-row-action-edit" onClick={onEdit} type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>编辑</span>
        </button>
        <button
          ref={triggerRef}
          className="shift-row-menu-trigger"
          onClick={toggleOpen}
          aria-expanded={open}
          type="button"
          title="更多操作"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className="shift-row-actions-menu"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              zIndex: "var(--z-dropdown, 1200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="shift-row-menu-item shift-row-menu-item--danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              type="button"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>删除班次</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
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
      setShowModal(null);
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
      <div className="master-slot-list" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
        {state.time_slots.map((slot, index) => (
          <div className="master-slot-row shift-slot-row admin-row-gap12" key={index}>
            <div className="time-picker-wrap">
              <TimePicker
                value={slot[0]}
                onChange={(val) => updateSlot(target, index, 0, val)}
                style={{ width: "100%" }}
              />
            </div>
            <span style={{ color: "#94a3b8", fontWeight: "600" }}>-</span>
            <div className="time-picker-wrap">
              <TimePicker
                value={slot[1]}
                onChange={(val) => updateSlot(target, index, 1, val)}
                style={{ width: "100%" }}
              />
            </div>
            <button
              className="shift-slot-delete-btn account-action-button account-action-button--danger"
              onClick={() => removeSlot(target, index)}
              title="删除此时间段"
              type="button"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
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
        <ShiftRowActions
          key={row.id}
          onDelete={() => removeShift(row)}
          onEdit={() => openEdit(row)}
        />,
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
      {/* 背景极光柔和光晕 */}
      <div className="qh-glow-sphere qh-glow-sphere--1" />
      <div className="qh-glow-sphere qh-glow-sphere--2" />

      {/* 顶部控制栏 (Top Executive Control Rail) */}
      <div className="shift-top-rail">
        <div className="shift-top-left">
          <div className="shift-title-group">
            <span className="shift-eyebrow">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              排班与工时规则
            </span>
            <h1 className="shift-main-title">班次管理</h1>
          </div>

          <div className="shift-metrics-capsules">
            <div className="shift-stat-pill">
              <span className="shift-stat-dot" />
              <span>班次总数：</span>
              <strong>{rows.length} 个</strong>
            </div>
            {rows.filter((r) => r.is_cross_day).length > 0 && (
              <div className="shift-stat-pill shift-stat-pill--info">
                <span className="shift-stat-dot shift-stat-dot--info" />
                <span>跨天班次：</span>
                <strong>{rows.filter((r) => r.is_cross_day).length} 个</strong>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 macOS 悬浮 Dock 操作条 */}
        <div className="shift-dock-container">
          <div className="shift-dock-bar">
            <button
              className="shift-dock-btn shift-dock-btn--primary btn btn-outline-secondary"
              onClick={() => setShowModal("create")}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建班次
            </button>

            <div className="shift-dock-divider" />

            <button
              className="shift-dock-btn account-action-button"
              onClick={loadRows}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* 数据表格区 (macOS Window Table Container) */}
      <div className="shift-table-window">
        {/* 表格标题条 */}
        <div
          className="account-card-header master-list-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 18px",
            borderBottom: "1px solid rgba(226, 232, 240, 0.8)",
            background: "rgba(248, 250, 252, 0.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700", fontSize: "13.5px", color: "var(--shift-text-main)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <span>班次列表</span>
          </div>
        </div>

        <QueryResultPanel>
          {loading ? (
            <div className="legacy-table-panel master-table-panel">
              <div className="legacy-table-wrap">
                <table className="legacy-table master-table">
                  <tbody>
                    <tr>
                      <td className="legacy-table-empty-cell">正在加载班次列表...</td>
                    </tr>
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
      </div>

      {/* 新增班次 Modal 弹窗 (常驻 DOM 以兼容自动化测试即时查找) */}
      <div
        className="shift-modal-backdrop master-modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
        style={{
          position: "fixed",
          left: showModal === "create" ? "0" : "-9999px",
          top: "0",
          width: "100%",
          height: "100%",
          zIndex: "var(--z-modal)",
          background: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          boxSizing: "border-box",
          opacity: showModal === "create" ? 1 : 0,
          pointerEvents: showModal === "create" ? "auto" : "none",
          transition: "opacity 0.18s ease",
        }}
      >
        <div className="shift-modal-window master-modal-container" style={{ width: "100%", maxWidth: "600px" }}>
          <div className="shift-modal-header">
            <div className="shift-modal-title-wrap">
              <span className="shift-modal-kicker page-tag">排班规则</span>
              <h3 className="shift-modal-title">新增班次</h3>
            </div>
            <button className="shift-modal-close-btn master-modal-close admin-icon-btn" onClick={handleCloseModal} type="button">×</button>
          </div>

          <form className="account-create-form" onSubmit={submitCreate}>
            <div className="shift-modal-body">
              {/* 基础信息 */}
              <div className="admin-stack">
                <h4 className="admin-modal-title">基础信息</h4>
                <div className="admin-form-grid">
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">班次编号</span>
                    <input
                      className="account-input"
                      onChange={(event) => setForm({ ...form, shift_no: event.target.value })}
                      placeholder="例如: A0001"
                      required
                      value={form.shift_no}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">班次名称</span>
                    <input
                      className="account-input"
                      onChange={(event) => setForm({ ...form, shift_name: event.target.value })}
                      placeholder="例如: 行政通用班次"
                      required
                      value={form.shift_name}
                    />
                  </label>
                </div>
              </div>

              {/* 时间规则 */}
              <div className="admin-stack">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(226, 232, 240, 0.8)", paddingBottom: "8px" }}>
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>时间规则</h4>
                  <button
                    className="shift-btn shift-btn--secondary account-action-button"
                    onClick={() => addSlot("create")}
                    style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}
                    type="button"
                  >
                    + 新增时间段
                  </button>
                </div>

                <div className="shift-slot-box">
                  <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      checked={form.is_cross_day}
                      onChange={(event) => setForm({ ...form, is_cross_day: event.target.checked })}
                      style={{ width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer", margin: 0 }}
                      type="checkbox"
                    />
                    <span className="admin-text" style={{ fontSize: "13px", fontWeight: "500", color: "#334155" }}>
                      允许跨天班次 (下班时间在次日)
                    </span>
                  </label>
                  {renderSlotEditor("create", form)}
                </div>
              </div>
            </div>

            <div className="shift-modal-footer">
              <button className="shift-btn shift-btn--secondary account-action-button" onClick={handleCloseModal} type="button">取消</button>
              <button className="shift-btn shift-btn--primary account-action-button account-action-button--primary account-primary-button" type="submit">
                创建班次
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 编辑班次 Modal 弹窗 */}
      {editing ? (
        <div className="shift-modal-backdrop master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <form className="shift-modal-window master-modal" onSubmit={submitEdit} style={{ maxWidth: "600px", width: "100%" }}>
            <div className="shift-modal-header">
              <div className="shift-modal-title-wrap">
                <span className="shift-modal-kicker">班次设置</span>
                <h2 className="shift-modal-title">编辑班次</h2>
              </div>
              <button className="shift-modal-close-btn master-modal-close" onClick={() => setEditing(null)} type="button">×</button>
            </div>
            <div className="shift-modal-body">
              {/* 基础信息 */}
              <div className="admin-stack">
                <h4 className="admin-modal-title">基础信息</h4>
                <div className="admin-form-grid">
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">班次编号</span>
                    <input
                      className="account-input"
                      onChange={(event) => setEditForm({ ...editForm, shift_no: event.target.value })}
                      placeholder="例如: A0001"
                      required
                      value={editForm.shift_no}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">班次名称</span>
                    <input
                      className="account-input"
                      onChange={(event) => setEditForm({ ...editForm, shift_name: event.target.value })}
                      placeholder="例如: 行政通用班次"
                      required
                      value={editForm.shift_name}
                    />
                  </label>
                </div>
              </div>

              {/* 时间规则 */}
              <div className="admin-stack">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(226, 232, 240, 0.8)", paddingBottom: "8px" }}>
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>时间规则</h4>
                  <button
                    className="shift-btn shift-btn--secondary account-action-button"
                    onClick={() => addSlot("edit")}
                    style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}
                    type="button"
                  >
                    + 新增时间段
                  </button>
                </div>

                <div className="shift-slot-box">
                  <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      checked={editForm.is_cross_day}
                      onChange={(event) => setEditForm({ ...editForm, is_cross_day: event.target.checked })}
                      style={{ width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer", margin: 0 }}
                      type="checkbox"
                    />
                    <span className="admin-text" style={{ fontSize: "13px", fontWeight: "500", color: "#334155" }}>
                      允许跨天班次 (下班时间在次日)
                    </span>
                  </label>
                  {renderSlotEditor("edit", editForm)}
                </div>
              </div>
            </div>

            <div className="shift-modal-footer">
              <button className="shift-btn shift-btn--secondary account-action-button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="shift-btn shift-btn--primary account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

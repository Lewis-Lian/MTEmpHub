import { FormEvent, useEffect, useState } from "react";

import { createAdminShift, deleteAdminShift, fetchAdminShifts, updateAdminShift } from "../../api/admin";
import type { AdminShift } from "../../types/admin";

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
  const [rows, setRows] = useState<AdminShift[]>([]);
  const [form, setForm] = useState<ShiftFormState>(emptyShiftForm);
  const [editing, setEditing] = useState<AdminShift | null>(null);
  const [editForm, setEditForm] = useState<ShiftFormState>(emptyShiftForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      setRows(await fetchAdminShifts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "班次列表加载失败");
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
    setMessage("");
    setError("");
    try {
      const timeSlots = validateShiftSlots(form.time_slots);
      await createAdminShift({
        ...form,
        time_slots: timeSlots,
      });
      setForm(emptyShiftForm);
      setMessage("班次已创建");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建班次失败");
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setMessage("");
    setError("");
    try {
      const timeSlots = validateShiftSlots(editForm.time_slots);
      await updateAdminShift(editing.id, {
        ...editForm,
        time_slots: timeSlots,
      });
      setEditing(null);
      setMessage("班次已保存");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存班次失败");
    }
  }

  async function removeShift(row: AdminShift) {
    if (!window.confirm(`确定删除班次 ${row.shift_no} - ${row.shift_name}？`)) {
      return;
    }
    setMessage("");
    setError("");
    try {
      await deleteAdminShift(row.id);
      setMessage("班次已删除");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除班次失败");
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

  return (
    <main className="master-data-page shifts-master-page">
      <div className="master-data-workflow">
        <aside className="master-data-side">
          <div className="sticky-side">
            <section className="account-card">
              <div className="account-card-header">
                <span>新增班次</span>
                <span className="page-tag">排班规则</span>
              </div>
              <div className="account-card-body">
                <form className="account-create-form" onSubmit={submitCreate}>
                  <label className="account-field">
                    <span className="account-field-label">班次编号</span>
                    <input className="account-input" onChange={(event) => setForm({ ...form, shift_no: event.target.value })} required value={form.shift_no} />
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">班次名称</span>
                    <input className="account-input" onChange={(event) => setForm({ ...form, shift_name: event.target.value })} required value={form.shift_name} />
                  </label>
                  <label className="master-check-option">
                    <input checked={form.is_cross_day} onChange={(event) => setForm({ ...form, is_cross_day: event.target.checked })} type="checkbox" />
                    <span>跨天班次</span>
                  </label>
                  <div className="account-field">
                    <div className="master-field-head">
                      <span className="account-field-label">班次时间段</span>
                      <button className="account-action-button" onClick={() => addSlot("create")} type="button">
                        新增时间段
                      </button>
                    </div>
                    {renderSlotEditor("create", form)}
                  </div>
                  <button className="account-action-button account-action-button--primary account-primary-button" type="submit">
                    创建班次
                  </button>
                </form>
                {message ? <div className="account-result-message">{message}</div> : null}
                {error ? <div className="legacy-inline-error">{error}</div> : null}
              </div>
            </section>
          </div>
        </aside>

        <section className="account-card master-data-main table-wrap-tight">
          <div className="account-card-header">
            <span>班次列表</span>
            <button className="account-action-button" onClick={loadRows} type="button">
              刷新
            </button>
          </div>
          <div className="legacy-table-panel master-table-panel">
            <div className="legacy-table-wrap">
              <table className="legacy-table master-table">
                <thead>
                  <tr>
                    <th className="legacy-table-head-cell"><div className="master-static-head">ID</div></th>
                    <th className="legacy-table-head-cell"><div className="master-static-head">班次编号</div></th>
                    <th className="legacy-table-head-cell"><div className="master-static-head">班次名称</div></th>
                    <th className="legacy-table-head-cell"><div className="master-static-head">时间段</div></th>
                    <th className="legacy-table-head-cell"><div className="master-static-head">跨天</div></th>
                    <th className="legacy-table-head-cell"><div className="master-static-head">操作</div></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="legacy-table-empty-cell" colSpan={6}>正在加载班次列表...</td></tr>
                  ) : rows.length ? (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <td className="legacy-table-body-cell">{row.id}</td>
                        <td className="legacy-table-body-cell">{row.shift_no}</td>
                        <td className="legacy-table-body-cell">{row.shift_name}</td>
                        <td className="legacy-table-body-cell">{formatSlots(row.time_slots)}</td>
                        <td className="legacy-table-body-cell">{row.is_cross_day ? "是" : "否"}</td>
                        <td className="legacy-table-body-cell">
                          <div className="toolbar">
                            <button className="account-action-button" onClick={() => openEdit(row)} type="button">编辑</button>
                            <button className="account-action-button account-action-button--danger" onClick={() => removeShift(row)} type="button">删除</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td className="legacy-table-empty-cell" colSpan={6}>暂无班次数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
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

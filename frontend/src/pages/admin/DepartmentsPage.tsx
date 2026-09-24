import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  batchAdminDepartments,
  createAdminDepartment,
  deleteAdminDepartment,
  deleteUnboundAdminDepartments,
  fetchAdminDepartments,
  importAdminDepartments,
  updateAdminDepartment,
} from "../../api/admin";
import DepartmentPicker from "../../components/query/DepartmentPicker";
import ExcelImportDropzone from "../../components/admin/ExcelImportDropzone";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import type { AdminDepartment } from "../../types/admin";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
import { useNotification } from "../../components/feedback/Notification";
import "./department-management.css";
import "./admin-management-shared.css";

type DepartmentFormState = {
  dept_no: string;
  dept_name: string;
  parent_id: string;
  is_locked: boolean;
};

const emptyDepartmentForm: DepartmentFormState = {
  dept_no: "",
  dept_name: "",
  parent_id: "",
  is_locked: false,
};

function departmentToForm(row: AdminDepartment): DepartmentFormState {
  return {
    dept_no: row.dept_no ?? "",
    dept_name: row.dept_name,
    parent_id: row.parent_id ? String(row.parent_id) : "",
    is_locked: Boolean(row.is_locked),
  };
}

function DepartmentRowActions({
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
    <div className="dept-row-actions" style={{ position: "relative" }}>
      <div className="dept-row-action-group">
        <button className="dept-row-action-edit" onClick={onEdit} type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>编辑</span>
        </button>
        <button
          ref={triggerRef}
          className="dept-row-menu-trigger"
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
            className="dept-row-actions-menu"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              zIndex: "var(--z-dropdown, 1200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dept-row-menu-item dept-row-menu-item--danger"
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
              <span>删除部门</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function DepartmentsPage() {
  const confirm = useConfirm();
  const notification = useNotification();
  const [rows, setRows] = useState<AdminDepartment[]>([]);

  const [form, setForm] = useState<DepartmentFormState>(emptyDepartmentForm);
  const [editing, setEditing] = useState<AdminDepartment | null>(null);
  const [editForm, setEditForm] = useState<DepartmentFormState>(emptyDepartmentForm);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState("");
  const [batchParentId, setBatchParentId] = useState("");
  const [batchParentModalOpen, setBatchParentModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<"create" | "import" | null>(null);

  const handleCloseModal = () => {
    setShowModal(null);
  };

  async function loadRows() {
    setLoading(true);
    try {
      const nextRows = await fetchAdminDepartments();
      setRows(nextRows);
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => row.id === id)));
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "部门列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function payloadFromForm(value: DepartmentFormState) {
    return {
      dept_no: value.dept_no,
      dept_name: value.dept_name,
      parent_id: value.parent_id || null,
      is_locked: value.is_locked,
    };
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    try {
      await createAdminDepartment(payloadFromForm(form));
      setForm(emptyDepartmentForm);
      notification.success("部门已创建");
      setShowModal(null);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "创建部门失败");
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    try {
      await updateAdminDepartment(editing.id, payloadFromForm(editForm));
      setEditing(null);
      notification.success("部门已保存");
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "保存部门失败");
    }
  }

  async function removeDepartment(row: AdminDepartment) {
    const isConfirmed = await confirm({
      message: `确定删除部门 ${row.dept_name}？`,
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await deleteAdminDepartment(row.id);
      notification.success("部门已删除");
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "删除部门失败");
    }
  }

  async function applyBatchAction() {
    if (!batchAction) {
      notification.warning("请选择批量操作");
      return;
    }
    if (selectedIds.length === 0) {
      notification.warning("请先选择部门");
      return;
    }
    if (batchAction === "set_parent") {
      setBatchParentId("");
      setBatchParentModalOpen(true);
      return;
    }
    try {
      await batchAdminDepartments({
        ids: selectedIds,
        action: batchAction,
      });
      setSelectedIds([]);
      setBatchAction("");
      setBatchParentId("");
      notification.success("批量操作已完成");
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "批量操作失败");
    }
  }

  async function applyBatchParent() {
    if (selectedIds.length === 0) {
      notification.warning("请先选择部门");
      return;
    }
    try {
      await batchAdminDepartments({
        ids: selectedIds,
        action: "set_parent",
        parent_id: batchParentId || null,
      });
      setSelectedIds([]);
      setBatchAction("");
      setBatchParentId("");
      setBatchParentModalOpen(false);
      notification.success("批量操作已完成");
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "批量操作失败");
    }
  }

  async function removeUnboundDepartments() {
    const isConfirmed = await confirm({
      message: "确定一键删除空部门？锁定、绑定员工或账号权限的部门会被跳过。",
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    try {
      const result = await deleteUnboundAdminDepartments();
      notification.success(`已删除 ${String(result.deleted ?? 0)} 个空部门`);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "删除空部门失败");
    }
  }

  function openEdit(row: AdminDepartment) {
    setEditing(row);
    setEditForm(departmentToForm(row));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;

    if (!importFile?.name) {
      notification.warning("请选择要导入的 xlsx 文件");
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
      notification.warning("仅支持 .xlsx 文件");
      return;
    }

    setIsImporting(true);
    try {
      const result = await importAdminDepartments(importFile);
      formEl.reset();
      setImportFile(null);
      notification.success(`导入成功，处理 ${String(result.imported)} 条`);
      setShowModal(null);
      await loadRows();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setIsImporting(false);
    }
  }

  const departmentTableHeaders = [
    {
      label: (
        <input
          checked={selectedIds.length > 0 && selectedIds.length === rows.length}
          onChange={(event) => setSelectedIds(event.target.checked ? rows.map((row) => row.id) : [])}
          type="checkbox"
        />
      ),
      sortable: false,
    },
    "ID",
    "部门编号",
    "部门名称",
    "上级部门",
    "锁定",
    { label: "操作", sortable: false },
  ];

  const departmentTableRows = loading
    ? []
    : rows.map((row) => [
        <input checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} type="checkbox" />,
        row.id,
        row.dept_no || "-",
        row.dept_name,
        row.parent_name || "顶级部门",
        row.is_locked ? "是" : "否",
        <DepartmentRowActions
          key={row.id}
          onDelete={() => removeDepartment(row)}
          onEdit={() => openEdit(row)}
        />,
      ]);

  const departmentTableSortRows = loading
    ? []
    : rows.map((row) => [
        "",
        row.id,
        row.dept_no || "-",
        row.dept_name,
        row.parent_name || "顶级部门",
        row.is_locked ? "是" : "否",
        "",
      ]);

  return (
    <main className="admin-management-page master-data-page department-master-page">
      {/* 背景极光微光晕 */}
      <div className="qh-glow-sphere qh-glow-sphere--1" />
      <div className="qh-glow-sphere qh-glow-sphere--2" />

      {/* 顶部控制栏 (Top Executive Control Rail) */}
      <div className="dept-top-rail">
        <div className="dept-top-left">
          <div className="dept-title-group">
            <span className="dept-eyebrow">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              组织架构管理
            </span>
            <h1 className="dept-main-title">部门管理</h1>
          </div>

          <div className="dept-metrics-capsules">
            <div className="dept-stat-pill">
              <span className="dept-stat-dot" />
              <span>部门总数：</span>
              <strong>{rows.length} 个</strong>
            </div>
            {rows.filter((r) => r.is_locked).length > 0 && (
              <div className="dept-stat-pill dept-stat-pill--warning">
                <span className="dept-stat-dot dept-stat-dot--warning" />
                <span>锁定部门：</span>
                <strong>{rows.filter((r) => r.is_locked).length} 个</strong>
              </div>
            )}
            {selectedIds.length > 0 && (
              <div className="dept-stat-pill">
                <span>已选：</span>
                <strong className="master-selected-count">{selectedIds.length} 项</strong>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 macOS 悬浮 Dock 操作条 */}
        <div className="dept-dock-container">
          <div className="dept-dock-bar">
            <button
              className="dept-dock-btn dept-dock-btn--primary btn btn-outline-secondary"
              onClick={() => setShowModal("create")}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建部门
            </button>

            <button
              className="dept-dock-btn btn btn-outline-secondary"
              onClick={() => setShowModal("import")}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              导入/导出部门
            </button>

            <button
              className="dept-dock-btn btn btn-outline-secondary"
              onClick={removeUnboundDepartments}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              一键删除空部门
            </button>

            <div className="dept-dock-divider" />

            {/* 批量操作控制区 */}
            <div className="dept-dock-batch-group toolbar">
              <span className="master-selected-count" style={{ display: "none" }}>
                已选 {selectedIds.length} 项
              </span>
              <select
                className="account-select master-batch-select dept-dock-batch-select"
                onChange={(event) => setBatchAction(event.target.value)}
                value={batchAction}
              >
                <option value="">批量操作</option>
                <option value="set_parent">更改上级部门</option>
                <option value="lock">锁定部门</option>
                <option value="unlock">取消锁定</option>
                <option value="delete">删除部门</option>
              </select>
              <button
                className="dept-dock-btn dept-dock-btn--batch-exec account-action-button account-action-button--primary"
                onClick={applyBatchAction}
                type="button"
              >
                执行
              </button>
            </div>

            <div className="dept-dock-divider" />

            <a
              className="dept-dock-btn dept-dock-btn--success dept-dock-btn--export account-action-button account-action-button--success"
              href="/api/admin/departments/export"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              导出全部部门
            </a>

            <button
              className="dept-dock-btn account-action-button"
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
      <div className="dept-table-window admin-management-table">
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700", fontSize: "13.5px", color: "var(--dept-text-main)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <span>部门列表</span>
          </div>
        </div>

        <QueryResultPanel>
          {loading ? (
            <div className="legacy-table-panel master-table-panel">
              <div className="legacy-table-wrap">
                <table className="legacy-table master-table">
                  <tbody>
                    <tr>
                      <td className="legacy-table-empty-cell">正在加载部门列表...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <QueryTable
              emptyText="暂无部门数据"
              headers={departmentTableHeaders}
              panelClassName="master-table-panel"
              rows={departmentTableRows}
              sortRows={departmentTableSortRows}
              tableClassName="master-table"
            />
          )}
        </QueryResultPanel>
      </div>

      {/* 编辑部门 Modal 弹窗 */}
      {editing ? (
        <div className="dept-modal-backdrop master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <form className="dept-modal-window master-modal department-parent-modal" onSubmit={submitEdit} style={{ maxWidth: "560px", width: "100%" }}>
            <div className="dept-modal-header">
              <div className="dept-modal-title-wrap">
                <span className="dept-modal-kicker">组织架构</span>
                <h3 className="dept-modal-title">编辑部门</h3>
              </div>
              <button className="dept-modal-close-btn master-modal-close" onClick={() => setEditing(null)} type="button">×</button>
            </div>
            <div className="dept-modal-body">
              <div className="admin-stack">
                <h4 className="admin-modal-title">基础信息</h4>
                <div className="admin-form-grid">
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">部门编号</span>
                    <input
                      className="account-input"
                      onChange={(event) => setEditForm({ ...editForm, dept_no: event.target.value })}
                      placeholder="请输入部门编号"
                      required
                      value={editForm.dept_no}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">部门名称</span>
                    <input
                      className="account-input"
                      onChange={(event) => setEditForm({ ...editForm, dept_name: event.target.value })}
                      placeholder="请输入部门名称"
                      required
                      value={editForm.dept_name}
                    />
                  </label>
                  <label className="account-field admin-form-grid-wide">
                    <span className="account-field-label">上级部门</span>
                    <DepartmentPicker
                      departments={rows}
                      excludedId={editing.id}
                      hiddenId="editDeptParentId"
                      inputId="editDeptParentInput"
                      lookupId="editDeptParentLookup"
                      onChange={(value) => setEditForm({ ...editForm, parent_id: value })}
                      pickerTitle="选择上级部门"
                      placeholder="选择上级部门"
                      quickListId="editDeptParentQuickList"
                      title="选择上级部门"
                      triggerId="openEditDeptParentPickerBtn"
                      value={editForm.parent_id}
                    />
                  </label>
                </div>
              </div>

              <div className="admin-stack">
                <h4 className="admin-modal-title">附加状态</h4>
                <div style={{ display: "flex", gap: "32px", padding: "12px 16px", background: "rgba(248, 250, 252, 0.7)", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
                  <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      checked={editForm.is_locked}
                      onChange={(event) => setEditForm({ ...editForm, is_locked: event.target.checked })}
                      style={{ width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer", margin: 0 }}
                      type="checkbox"
                    />
                    <span className="admin-text">锁定部门</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="dept-modal-footer admin-management-modal-footer">
              <button className="dept-btn dept-btn--secondary account-action-button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="dept-btn dept-btn--primary account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {/* 批量更改上级部门 Modal 弹窗 */}
      {batchParentModalOpen ? (
        <div className="dept-modal-backdrop master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBatchParentModalOpen(false); }}>
          <div className="dept-modal-window master-modal department-parent-modal" style={{ maxWidth: "540px", width: "100%" }}>
            <div className="dept-modal-header">
              <div className="dept-modal-title-wrap">
                <span className="dept-modal-kicker">批量操作</span>
                <h2 className="dept-modal-title">批量更改上级部门</h2>
              </div>
              <button className="dept-modal-close-btn master-modal-close" onClick={() => setBatchParentModalOpen(false)} type="button">×</button>
            </div>
            <div className="dept-modal-body">
              <label className="account-field">
                <span className="account-field-label">上级部门</span>
                <DepartmentPicker
                  departments={rows}
                  hiddenId="batchParentDeptId"
                  inputId="batchParentDeptInput"
                  lookupId="batchDeptParentLookup"
                  onChange={setBatchParentId}
                  pickerTitle="选择上级部门"
                  placeholder="选择上级部门"
                  quickListId="batchParentDeptQuickList"
                  title="选择上级部门"
                  triggerId="openBatchDeptParentPickerBtn"
                  value={batchParentId}
                />
              </label>
              <div className="master-form-text" style={{ fontSize: "13px", color: "var(--dept-text-secondary)", marginTop: "4px" }}>
                将应用到已选 {selectedIds.length} 个部门。
              </div>
            </div>
            <div className="dept-modal-footer admin-management-modal-footer">
              <button className="dept-btn dept-btn--secondary account-action-button" onClick={() => setBatchParentModalOpen(false)} type="button">取消</button>
              <button className="dept-btn dept-btn--primary account-action-button account-action-button--primary" onClick={applyBatchParent} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 新增部门 Modal 弹窗 */}
      {showModal === "create" ? <div
        className="dept-modal-backdrop master-modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
      >
        <div className="dept-modal-window master-modal-container department-parent-modal" style={{ width: "100%", maxWidth: "560px" }}>
          <div className="dept-modal-header">
            <div className="dept-modal-title-wrap">
              <span className="dept-modal-kicker">组织架构</span>
              <h3 className="dept-modal-title">新增部门</h3>
            </div>
            <button className="dept-modal-close-btn master-modal-close admin-modal-close" onClick={handleCloseModal} type="button">×</button>
          </div>
          <form className="account-create-form" onSubmit={submitCreate}>
            <div className="dept-modal-body">
              <div className="admin-stack">
                <h4 className="admin-modal-title">基础信息</h4>
                <div className="admin-form-grid">
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">部门编号</span>
                    <input
                      className="account-input"
                      onChange={(event) => setForm({ ...form, dept_no: event.target.value })}
                      placeholder="请输入部门编号"
                      required
                      value={form.dept_no}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">部门名称</span>
                    <input
                      className="account-input"
                      onChange={(event) => setForm({ ...form, dept_name: event.target.value })}
                      placeholder="请输入部门名称"
                      required
                      value={form.dept_name}
                    />
                  </label>
                  <label className="account-field admin-form-grid-wide">
                    <span className="account-field-label">上级部门</span>
                    <DepartmentPicker
                      departments={rows}
                      hiddenId="createDeptParentId"
                      inputId="createDeptParentInput"
                      lookupId="createDeptParentLookup"
                      onChange={(value) => setForm({ ...form, parent_id: value })}
                      pickerTitle="选择上级部门"
                      placeholder="选择上级部门"
                      quickListId="createDeptParentQuickList"
                      title="选择上级部门"
                      triggerId="openCreateDeptParentPickerBtn"
                      value={form.parent_id}
                    />
                  </label>
                </div>
              </div>

              <div className="admin-stack">
                <h4 className="admin-modal-title">附加状态</h4>
                <div style={{ display: "flex", gap: "32px", padding: "12px 16px", background: "rgba(248, 250, 252, 0.7)", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
                  <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      checked={form.is_locked}
                      onChange={(event) => setForm({ ...form, is_locked: event.target.checked })}
                      style={{ width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer", margin: 0 }}
                      type="checkbox"
                    />
                    <span className="admin-text">锁定部门</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="dept-modal-footer admin-management-modal-footer">
              <button className="dept-btn dept-btn--secondary account-action-button" onClick={handleCloseModal} type="button">取消</button>
              <button className="dept-btn dept-btn--primary account-action-button account-action-button--primary account-primary-button" type="submit">创建部门</button>
            </div>
          </form>
        </div>
      </div> : null}

      {/* 导入/导出部门 Modal 弹窗 */}
      {showModal === "import" ? <div
        className="dept-modal-backdrop master-modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
      >
        <div className="dept-modal-window master-modal-container" style={{ width: "100%", maxWidth: "600px" }}>
          <div className="dept-modal-header">
            <div className="dept-modal-title-wrap">
              <span className="dept-modal-kicker">数据传输</span>
              <h3 className="dept-modal-title">数据导入与导出</h3>
            </div>
            <button className="dept-modal-close-btn master-modal-close admin-modal-close" onClick={handleCloseModal} type="button">×</button>
          </div>

          <div className="dept-modal-body">
            {/* 批量导入专区 */}
            <form className="account-upload-group" encType="multipart/form-data" onSubmit={submitImport} style={{ display: "flex", flexDirection: "column", gap: "16px", margin: 0 }}>
              <ExcelImportDropzone className="account-upload-dropzone" file={importFile} onFileChange={setImportFile} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <a
                  className="account-action-button"
                  href="/api/admin/departments/template"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12.5px",
                    padding: "6px 14px",
                    borderRadius: "8px",
                    color: "#4f46e5",
                    background: "rgba(238, 242, 255, 0.8)",
                    border: "1px solid rgba(199, 210, 254, 0.8)",
                    fontWeight: "600",
                    textDecoration: "none",
                  }}
                >
                  ↓ 下载示例模板
                </a>
                <button
                  className={`dept-btn dept-btn--primary account-action-button account-action-button--primary${isImporting ? " is-loading" : ""}`}
                  disabled={isImporting}
                  type="submit"
                >
                  {isImporting ? "导入中..." : "开始导入"}
                </button>
              </div>
            </form>

            <div style={{ height: "1px", background: "rgba(226, 232, 240, 0.8)" }} />

            {/* 数据导出专区 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <h4 style={{ margin: 0, fontSize: "13.5px", fontWeight: "650", color: "#1e293b" }}>数据导出</h4>
              <div style={{ display: "flex", gap: "12px" }}>
                <a
                  className="dept-btn dept-btn--secondary account-action-button"
                  href="/api/admin/departments/export"
                  style={{ flex: 1, textDecoration: "none" }}
                >
                  导出全部部门数据
                </a>
              </div>
            </div>

            <div
              className="panel-note"
              style={{
                margin: 0,
                padding: "10px 14px",
                background: "rgba(254, 243, 199, 0.7)",
                borderRadius: "10px",
                color: "#92400e",
                fontSize: "12.5px",
                border: "1px solid rgba(253, 230, 138, 0.9)",
                lineHeight: "1.5",
              }}
            >
              <strong style={{ color: "#78350f" }}>模板列要求：</strong>
              <br />
              部门编号、部门名称、上级部门编号（可空）。
            </div>
          </div>
        </div>
      </div> : null}
    </main>
  );
}

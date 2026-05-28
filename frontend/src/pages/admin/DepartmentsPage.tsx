import { FormEvent, useEffect, useState } from "react";

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
import QueryTable from "../../components/query/QueryTable";
import type { AdminDepartment } from "../../types/admin";

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

export default function DepartmentsPage() {
  const [rows, setRows] = useState<AdminDepartment[]>([]);
  const [form, setForm] = useState<DepartmentFormState>(emptyDepartmentForm);
  const [editing, setEditing] = useState<AdminDepartment | null>(null);
  const [editForm, setEditForm] = useState<DepartmentFormState>(emptyDepartmentForm);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState("");
  const [batchParentId, setBatchParentId] = useState("");
  const [batchParentModalOpen, setBatchParentModalOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const [loading, setLoading] = useState(true);

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const nextRows = await fetchAdminDepartments();
      setRows(nextRows);
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => row.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "部门列表加载失败");
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
    setMessage("");
    setError("");
    try {
      await createAdminDepartment(payloadFromForm(form));
      setForm(emptyDepartmentForm);
      setMessage("部门已创建");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建部门失败");
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
      await updateAdminDepartment(editing.id, payloadFromForm(editForm));
      setEditing(null);
      setMessage("部门已保存");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存部门失败");
    }
  }

  async function removeDepartment(row: AdminDepartment) {
    if (!window.confirm(`确定删除部门 ${row.dept_name}？`)) {
      return;
    }
    setMessage("");
    setError("");
    try {
      await deleteAdminDepartment(row.id);
      setMessage("部门已删除");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除部门失败");
    }
  }

  async function applyBatchAction() {
    if (!batchAction) {
      setError("请选择批量操作");
      return;
    }
    if (selectedIds.length === 0) {
      setError("请先选择部门");
      return;
    }
    if (batchAction === "set_parent") {
      setBatchParentId("");
      setBatchParentModalOpen(true);
      return;
    }
    setMessage("");
    setError("");
    try {
      await batchAdminDepartments({
        ids: selectedIds,
        action: batchAction,
      });
      setSelectedIds([]);
      setBatchAction("");
      setBatchParentId("");
      setMessage("批量操作已完成");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量操作失败");
    }
  }

  async function applyBatchParent() {
    if (selectedIds.length === 0) {
      setError("请先选择部门");
      return;
    }
    setMessage("");
    setError("");
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
      setMessage("批量操作已完成");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量操作失败");
    }
  }

  async function removeUnboundDepartments() {
    if (!window.confirm("确定一键删除空部门？锁定、绑定员工或账号权限的部门会被跳过。")) {
      return;
    }
    setMessage("");
    setError("");
    try {
      const result = await deleteUnboundAdminDepartments();
      setMessage(`已删除 ${String(result.deleted ?? 0)} 个空部门`);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除空部门失败");
    }
  }

  function openEdit(row: AdminDepartment) {
    setEditing(row);
    setEditForm(departmentToForm(row));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    setImportMessage("");
    setImportError("");

    if (!importFile?.name) {
      setImportError("请选择要导入的 xlsx 文件");
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
      setImportError("仅支持 .xlsx 文件");
      return;
    }

    setIsImporting(true);
    try {
      const result = await importAdminDepartments(importFile);
      form.reset();
      setImportFile(null);
      setImportInputKey((current) => current + 1);
      setImportMessage(`导入成功，处理 ${String(result.imported)} 条`);
      await loadRows();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "导入失败");
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
        <div className="toolbar">
          <button className="account-action-button" onClick={() => openEdit(row)} type="button">编辑</button>
          <button className="account-action-button account-action-button--danger" onClick={() => removeDepartment(row)} type="button">删除</button>
        </div>,
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
    <main className="master-data-page department-master-page">
      <div className="master-data-workflow">
        <aside className="master-data-side">
          <section className="account-card department-lookup-card">
            <div className="account-card-header">
              <span>新增部门</span>
              <span className="page-tag">组织主数据</span>
            </div>
            <div className="account-card-body">
              <form className="account-create-form" onSubmit={submitCreate}>
                <label className="account-field">
                  <span className="account-field-label">部门编号</span>
                  <input className="account-input" onChange={(event) => setForm({ ...form, dept_no: event.target.value })} required value={form.dept_no} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">部门名称</span>
                  <input className="account-input" onChange={(event) => setForm({ ...form, dept_name: event.target.value })} required value={form.dept_name} />
                </label>
                <label className="account-field">
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
                <label className="master-check-option">
                  <input checked={form.is_locked} onChange={(event) => setForm({ ...form, is_locked: event.target.checked })} type="checkbox" />
                  <span>锁定部门</span>
                </label>
                <button className="account-action-button account-action-button--primary account-primary-button" type="submit">
                  创建部门
                </button>
              </form>
              {message ? <div className="account-result-message">{message}</div> : null}
              {error ? <div className="legacy-inline-error">{error}</div> : null}
            </div>
          </section>

          <section className="account-card department-lookup-card">
            <div className="account-card-header">导入部门（xlsx）</div>
            <div className="account-card-body">
              <form className="account-upload-group" encType="multipart/form-data" onSubmit={submitImport}>
                <input
                  key={importInputKey}
                  className="account-file-input"
                  name="file"
                  required
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
                <div className="toolbar">
                  <button className="account-action-button account-action-button--primary" disabled={isImporting} type="submit">
                    {isImporting ? "导入中..." : "上传导入"}
                  </button>
                  <a className="account-action-button" href="/api/admin/departments/template">下载示例模板</a>
                </div>
              </form>
              <div className="panel-note">模板字段：部门编号、部门名称、上级部门编号（可空）。</div>
              {importMessage ? <div className="account-result-message">{importMessage}</div> : null}
              {importError ? <div className="legacy-inline-error">{importError}</div> : null}
            </div>
          </section>
        </aside>

        <section className="account-card master-data-main">
          <div className="account-card-header master-list-header">
            <span>部门列表</span>
            <div className="toolbar">
              <span className="master-selected-count">已选 {selectedIds.length} 项</span>
              <button className="account-action-button account-action-button--warning" onClick={removeUnboundDepartments} type="button">一键删除空部门</button>
              <select className="account-select master-batch-select" onChange={(event) => setBatchAction(event.target.value)} value={batchAction}>
                <option value="">批量操作</option>
                <option value="set_parent">更改上级部门</option>
                <option value="lock">锁定部门</option>
                <option value="unlock">取消锁定</option>
                <option value="delete">删除部门</option>
              </select>
              <button className="account-action-button account-action-button--primary" onClick={applyBatchAction} type="button">执行</button>
              <a className="account-action-button account-action-button--success" href="/api/admin/departments/export">导出全部部门</a>
              <button className="account-action-button" onClick={loadRows} type="button">刷新</button>
            </div>
          </div>
          {loading ? (
            <div className="legacy-table-panel master-table-panel">
              <div className="legacy-table-wrap">
                <table className="legacy-table master-table">
                  <tbody>
                    <tr><td className="legacy-table-empty-cell">正在加载部门列表...</td></tr>
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
        </section>
      </div>

      {editing ? (
        <div className="master-modal-backdrop">
          <form className="master-modal department-parent-modal" onSubmit={submitEdit}>
            <div className="master-modal-header">
              <h2>编辑部门</h2>
              <button className="master-modal-close" onClick={() => setEditing(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <label className="account-field">
                <span className="account-field-label">部门编号</span>
                <input className="account-input" onChange={(event) => setEditForm({ ...editForm, dept_no: event.target.value })} required value={editForm.dept_no} />
              </label>
              <label className="account-field">
                <span className="account-field-label">部门名称</span>
                <input className="account-input" onChange={(event) => setEditForm({ ...editForm, dept_name: event.target.value })} required value={editForm.dept_name} />
              </label>
              <label className="account-field">
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
              <label className="master-check-option">
                <input checked={editForm.is_locked} onChange={(event) => setEditForm({ ...editForm, is_locked: event.target.checked })} type="checkbox" />
                <span>锁定部门</span>
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {batchParentModalOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal department-parent-modal">
            <div className="master-modal-header">
              <h2>批量更改上级部门</h2>
              <button className="master-modal-close" onClick={() => setBatchParentModalOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body">
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
              <div className="master-form-text">将应用到已选 {selectedIds.length} 个部门。</div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchParentModalOpen(false)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" onClick={applyBatchParent} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

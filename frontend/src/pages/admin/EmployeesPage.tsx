import { FormEvent, useEffect, useState } from "react";

import {
  batchAdminEmployees,
  createAdminEmployee,
  deleteAdminEmployee,
  fetchAdminDepartments,
  fetchAdminEmployees,
  fetchAdminShifts,
  importAdminEmployees,
  updateAdminEmployee,
} from "../../api/admin";
import DepartmentPicker from "../../components/query/DepartmentPicker";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryTable from "../../components/query/QueryTable";
import type { AdminDepartment, AdminEmployee, AdminShift } from "../../types/admin";
import type { DepartmentOption, QueryEmployee } from "../../types/query";

type EmployeeFormState = {
  emp_no: string;
  name: string;
  dept_name: string;
  shift_no: string;
  is_manager: boolean;
  is_nursing: boolean;
  employee_stats_attendance_source: string;
  manager_stats_attendance_source: string;
};

const emptyEmployeeForm: EmployeeFormState = {
  emp_no: "",
  name: "",
  dept_name: "",
  shift_no: "",
  is_manager: false,
  is_nursing: false,
  employee_stats_attendance_source: "employee",
  manager_stats_attendance_source: "manager",
};

const attendanceSourceLabels: Record<string, string> = {
  employee: "员工考勤源文件取值",
  manager: "管理人员考勤源文件取值",
  auto_fallback: "自动回退",
};

function employeeToForm(row: AdminEmployee): EmployeeFormState {
  return {
    emp_no: row.emp_no,
    name: row.name,
    dept_name: row.dept_name ?? "",
    shift_no: row.shift_no ?? "",
    is_manager: Boolean(row.is_manager),
    is_nursing: Boolean(row.is_nursing),
    employee_stats_attendance_source: row.employee_stats_attendance_source ?? "employee",
    manager_stats_attendance_source: row.manager_stats_attendance_source ?? "manager",
  };
}

export default function EmployeesPage() {
  const [rows, setRows] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [shifts, setShifts] = useState<AdminShift[]>([]);
  const [form, setForm] = useState<EmployeeFormState>(emptyEmployeeForm);
  const [editing, setEditing] = useState<AdminEmployee | null>(null);
  const [editForm, setEditForm] = useState<EmployeeFormState>(emptyEmployeeForm);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [nursingFilter, setNursingFilter] = useState("");
  const [employeeSourceFilter, setEmployeeSourceFilter] = useState("");
  const [managerSourceFilter, setManagerSourceFilter] = useState("");
  const [filterEmployeeIds, setFilterEmployeeIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState("");
  const [batchValue, setBatchValue] = useState("");
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
      const [nextEmployees, nextDepartments, nextShifts] = await Promise.all([
        fetchAdminEmployees(),
        fetchAdminDepartments(),
        fetchAdminShifts(),
      ]);
      setRows(nextEmployees);
      setDepartments(nextDepartments);
      setShifts(nextShifts);
      setSelectedIds((current) => current.filter((id) => nextEmployees.some((row) => row.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "员工列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  const filteredRows = rows.filter((row) => {
    if (filterEmployeeIds.length && !filterEmployeeIds.includes(row.id)) {
      return false;
    }
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword && !`${row.emp_no} ${row.name}`.toLowerCase().includes(normalizedKeyword)) {
      return false;
    }
    if (typeFilter === "employee" && row.is_manager) {
      return false;
    }
    if (typeFilter === "manager" && !row.is_manager) {
      return false;
    }
    if (nursingFilter === "1" && !row.is_nursing) {
      return false;
    }
    if (nursingFilter === "0" && row.is_nursing) {
      return false;
    }
    if (employeeSourceFilter && row.employee_stats_attendance_source !== employeeSourceFilter) {
      return false;
    }
    return !(managerSourceFilter && row.manager_stats_attendance_source !== managerSourceFilter);
  });

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function clearFilters() {
    setKeyword("");
    setTypeFilter("");
    setNursingFilter("");
    setEmployeeSourceFilter("");
    setManagerSourceFilter("");
    setFilterEmployeeIds([]);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      await createAdminEmployee(form);
      setForm(emptyEmployeeForm);
      setMessage("员工已创建");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建员工失败");
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
      await updateAdminEmployee(editing.id, editForm);
      setEditing(null);
      setMessage("员工已保存");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存员工失败");
    }
  }

  async function removeEmployee(row: AdminEmployee) {
    if (!window.confirm(`确定删除员工 ${row.emp_no} - ${row.name}？`)) {
      return;
    }
    setMessage("");
    setError("");
    try {
      await deleteAdminEmployee(row.id);
      setMessage("员工已删除");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除员工失败");
    }
  }

  function batchPayload() {
    const payload: Record<string, unknown> = { ids: selectedIds, action: batchAction };
    if (batchAction === "set_name") payload.name = batchValue;
    if (batchAction === "set_emp_no") payload.emp_no = batchValue;
    if (batchAction === "set_department") payload.dept_name = batchValue;
    if (batchAction === "set_shift") payload.shift_no = batchValue;
    if (batchAction === "set_manager") payload.is_manager = batchValue === "1";
    if (batchAction === "set_nursing") payload.is_nursing = batchValue === "1";
    if (batchAction === "set_employee_stats_attendance_source") payload.employee_stats_attendance_source = batchValue;
    if (batchAction === "set_manager_stats_attendance_source") payload.manager_stats_attendance_source = batchValue;
    return payload;
  }

  async function applyBatchAction() {
    if (!batchAction) {
      setError("请选择批量操作");
      return;
    }
    if (selectedIds.length === 0) {
      setError("请先选择员工");
      return;
    }
    setMessage("");
    setError("");
    try {
      await batchAdminEmployees(batchPayload());
      setSelectedIds([]);
      setBatchAction("");
      setBatchValue("");
      setMessage("批量操作已完成");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量操作失败");
    }
  }

  function openEdit(row: AdminEmployee) {
    setEditing(row);
    setEditForm(employeeToForm(row));
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
      const result = await importAdminEmployees(importFile);
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

  function renderDepartmentSelect(
    value: string,
    onChange: (value: string) => void,
    target: "create" | "edit" | "batch",
  ) {
    const lookupId = target === "create" ? "createEmployeeDeptLookup" : target === "edit" ? "editEmployeeDeptLookup" : "batchDeptInlineLookup";
    const inputId = target === "create" ? "createEmployeeDeptInput" : target === "edit" ? "editEmployeeDeptInput" : "batchDeptInlineInput";
    const hiddenId = target === "create" ? "createEmployeeDeptId" : target === "edit" ? "editEmployeeDeptId" : "batchDeptInlineId";
    const quickListId =
      target === "create" ? "createEmployeeDeptQuickList" : target === "edit" ? "editEmployeeDeptQuickList" : "batchDeptInlineQuickList";
    const triggerId =
      target === "create" ? "openCreateEmployeeDeptPickerBtn" : target === "edit" ? "openEditEmployeeDeptPickerBtn" : "openBatchDeptInlinePickerBtn";
    return (
      <DepartmentPicker
        departments={departments}
        hiddenId={hiddenId}
        inputId={inputId}
        lookupId={lookupId}
        onChange={onChange}
        pickerTitle="选择部门"
        placeholder="选择部门"
        quickListId={quickListId}
        quickEmptyValueLabel="无（不绑定部门）"
        rootOptionLabel="不绑定部门"
        selectedEmptyLabel="未选择部门"
        title="选择部门"
        triggerId={triggerId}
        value={value}
        valueMode="name"
      />
    );
  }

  function renderShiftSelect(value: string, onChange: (value: string) => void) {
    return (
      <select className="account-select" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">不绑定</option>
        {shifts.map((row) => (
          <option key={row.id} value={row.shift_no}>
            {row.shift_no} - {row.shift_name}
          </option>
        ))}
      </select>
    );
  }

  function renderSourceSelect(value: string, onChange: (value: string) => void) {
    return (
      <select className="account-select" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="employee">员工考勤源文件取值</option>
        <option value="manager">管理人员考勤源文件取值</option>
        <option value="auto_fallback">自动回退</option>
      </select>
    );
  }

  const pickerEmployees: QueryEmployee[] = rows.map((row) => ({
    id: row.id,
    emp_no: row.emp_no,
    name: row.name,
    dept_id: row.dept_id ?? null,
    dept_name: row.dept_name ?? "",
    is_manager: Boolean(row.is_manager),
  }));
  const pickerDepartments: DepartmentOption[] = departments.map((row) => ({
    id: row.id,
    dept_no: row.dept_no ?? "",
    dept_name: row.dept_name,
    parent_id: row.parent_id,
  }));
  const employeeTableHeaders = [
    {
      label: (
        <input
          checked={selectedIds.length > 0 && selectedIds.length === filteredRows.length}
          onChange={(event) => setSelectedIds(event.target.checked ? filteredRows.map((row) => row.id) : [])}
          type="checkbox"
        />
      ),
      sortable: false,
    },
    "ID",
    "人员编号",
    "人员姓名",
    "人员类型",
    "哺乳假",
    "员工考勤统计来源",
    "管理人员考勤统计来源",
    "部门名称",
    "班次",
    { label: "操作", sortable: false },
  ];
  const employeeTableRows = loading
    ? []
    : filteredRows.map((row) => [
        <input checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} type="checkbox" />,
        row.id,
        row.emp_no,
        row.name,
        row.is_manager ? "管理人员" : "普通员工",
        row.is_nursing ? "是" : "否",
        attendanceSourceLabels[row.employee_stats_attendance_source ?? ""] ?? "-",
        attendanceSourceLabels[row.manager_stats_attendance_source ?? ""] ?? "-",
        row.dept_name || "-",
        row.shift_no ? `${row.shift_no}${row.shift_name ? ` - ${row.shift_name}` : ""}` : "不绑定",
        <div className="toolbar">
          <button className="account-action-button" onClick={() => openEdit(row)} type="button">编辑</button>
          <button className="account-action-button account-action-button--danger" onClick={() => removeEmployee(row)} type="button">删除</button>
        </div>,
      ]);
  const employeeTableSortRows = loading
    ? []
    : filteredRows.map((row) => [
        "",
        row.id,
        row.emp_no,
        row.name,
        row.is_manager ? "管理人员" : "普通员工",
        row.is_nursing ? "是" : "否",
        attendanceSourceLabels[row.employee_stats_attendance_source ?? ""] ?? "-",
        attendanceSourceLabels[row.manager_stats_attendance_source ?? ""] ?? "-",
        row.dept_name || "-",
        row.shift_no ? `${row.shift_no}${row.shift_name ? ` - ${row.shift_name}` : ""}` : "不绑定",
        "",
      ]);

  function renderBatchValueControl() {
    if (batchAction === "set_department") {
      return renderDepartmentSelect(batchValue, setBatchValue, "batch");
    }
    if (batchAction === "set_shift") {
      return renderShiftSelect(batchValue, setBatchValue);
    }
    if (batchAction === "set_manager") {
      return (
        <select className="account-select" onChange={(event) => setBatchValue(event.target.value)} value={batchValue}>
          <option value="">选择人员类型</option>
          <option value="0">普通员工</option>
          <option value="1">管理人员</option>
        </select>
      );
    }
    if (batchAction === "set_nursing") {
      return (
        <select className="account-select" onChange={(event) => setBatchValue(event.target.value)} value={batchValue}>
          <option value="">选择哺乳假</option>
          <option value="0">否</option>
          <option value="1">是</option>
        </select>
      );
    }
    if (batchAction === "set_employee_stats_attendance_source" || batchAction === "set_manager_stats_attendance_source") {
      return renderSourceSelect(batchValue, setBatchValue);
    }
    return (
      <input
        className="account-input"
        disabled={!batchAction || batchAction === "delete"}
        onChange={(event) => setBatchValue(event.target.value)}
        placeholder="操作值"
        value={batchValue}
      />
    );
  }

  function renderEmployeeForm(
    state: EmployeeFormState,
    onChange: (value: EmployeeFormState) => void,
    submitLabel: string,
    departmentTarget: "create" | "edit",
    showSubmit = true,
  ) {
    return (
      <>
        <label className="account-field">
          <span className="account-field-label">人员编号</span>
          <input className="account-input" onChange={(event) => onChange({ ...state, emp_no: event.target.value })} required value={state.emp_no} />
        </label>
        <label className="account-field">
          <span className="account-field-label">人员姓名</span>
          <input className="account-input" onChange={(event) => onChange({ ...state, name: event.target.value })} required value={state.name} />
        </label>
        <label className="account-field">
          <span className="account-field-label">部门名称</span>
          {renderDepartmentSelect(state.dept_name, (value) => onChange({ ...state, dept_name: value }), departmentTarget)}
        </label>
        <label className="account-field">
          <span className="account-field-label">班次编号</span>
          {renderShiftSelect(state.shift_no, (value) => onChange({ ...state, shift_no: value }))}
        </label>
        <label className="master-check-option">
          <input checked={state.is_manager} onChange={(event) => onChange({ ...state, is_manager: event.target.checked })} type="checkbox" />
          <span>管理人员</span>
        </label>
        <label className="master-check-option">
          <input checked={state.is_nursing} onChange={(event) => onChange({ ...state, is_nursing: event.target.checked })} type="checkbox" />
          <span>哺乳假</span>
        </label>
        <label className="account-field">
          <span className="account-field-label">员工考勤统计来源</span>
          {renderSourceSelect(state.employee_stats_attendance_source, (value) => onChange({ ...state, employee_stats_attendance_source: value }))}
          <span className="master-form-text">普通员工使用此项，管理人员时该项不可编辑。</span>
        </label>
        <label className="account-field">
          <span className="account-field-label">管理人员考勤统计来源</span>
          {renderSourceSelect(state.manager_stats_attendance_source, (value) => onChange({ ...state, manager_stats_attendance_source: value }))}
          <span className="master-form-text">管理人员使用此项，普通员工时该项不可编辑。</span>
        </label>
        {showSubmit ? (
          <button className="account-action-button account-action-button--primary account-primary-button" type="submit">
            {submitLabel}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <main className="master-data-page employee-master-page">
      <div className="master-data-workflow">
        <aside className="master-data-side">
          <section className="account-card employee-lookup-card">
            <div className="account-card-header">
              <span>新增员工</span>
              <span className="page-tag">支持批量操作</span>
            </div>
            <div className="account-card-body">
              <form className="account-create-form" onSubmit={submitCreate}>
                {renderEmployeeForm(form, setForm, "创建员工", "create")}
              </form>
              {message ? <div className="account-result-message">{message}</div> : null}
              {error ? <div className="legacy-inline-error">{error}</div> : null}
            </div>
          </section>

          <section className="account-card employee-lookup-card">
            <div className="account-card-header">导入员工（xlsx）</div>
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
                  <a className="account-action-button" href="/api/admin/employees/template">下载示例模板</a>
                  <a className="account-action-button" href="/api/admin/employees/export">导出主数据</a>
                  <button className="account-action-button" type="button">导出筛选结果</button>
                </div>
              </form>
              <div className="panel-note">模板列：人员编号、人员姓名、部门名称、班次编号、是否管理人员、是否哺乳假、员工考勤统计来源、管理人员考勤统计来源。</div>
              {importMessage ? <div className="account-result-message">{importMessage}</div> : null}
              {importError ? <div className="legacy-inline-error">{importError}</div> : null}
            </div>
          </section>

          <div className="master-side-note">
            班次维护已迁移到独立页面：<a href="/admin/shifts/manage">前往班次管理</a>
          </div>
        </aside>

        <section className="account-card master-data-main">
          <div className="account-card-header master-list-header">
            <span>员工列表</span>
            <div className="toolbar">
              <span className="master-selected-count">已选 {selectedIds.length} 人</span>
              <button className="account-action-button" onClick={loadRows} type="button">刷新</button>
            </div>
          </div>

          <div className="master-filter-panel">
            <div className="master-filter-grid">
              <label className="account-field">
                <span className="account-field-label">员工筛选器</span>
                <EmployeePicker
                  departments={pickerDepartments}
                  employees={pickerEmployees}
                  onChange={setFilterEmployeeIds}
                  selectedIds={filterEmployeeIds}
                  showFieldChrome={false}
                />
              </label>
              <label className="account-field">
                <span className="account-field-label">人员类型</span>
                <select className="account-select" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
                  <option value="">全部</option>
                  <option value="employee">普通员工</option>
                  <option value="manager">管理人员</option>
                </select>
              </label>
              <label className="account-field">
                <span className="account-field-label">哺乳假</span>
                <select className="account-select" onChange={(event) => setNursingFilter(event.target.value)} value={nursingFilter}>
                  <option value="">全部</option>
                  <option value="1">是</option>
                  <option value="0">否</option>
                </select>
              </label>
              <label className="account-field">
                <span className="account-field-label">员工考勤统计来源</span>
                <select className="account-select" onChange={(event) => setEmployeeSourceFilter(event.target.value)} value={employeeSourceFilter}>
                  <option value="">全部</option>
                  <option value="employee">员工考勤源文件取值</option>
                  <option value="manager">管理人员考勤源文件取值</option>
                  <option value="auto_fallback">自动回退</option>
                </select>
              </label>
              <label className="account-field">
                <span className="account-field-label">管理人员考勤统计来源</span>
                <select className="account-select" onChange={(event) => setManagerSourceFilter(event.target.value)} value={managerSourceFilter}>
                  <option value="">全部</option>
                  <option value="manager">管理人员考勤源文件取值</option>
                  <option value="employee">员工考勤源文件取值</option>
                  <option value="auto_fallback">自动回退</option>
                </select>
              </label>
            </div>
            <div className="master-filter-actions">
              <span>当前显示 {filteredRows.length} / {rows.length} 人</span>
              <button className="account-action-button" onClick={() => { setKeyword(""); setFilterEmployeeIds([]); }} type="button">清除筛选内容</button>
              <button className="account-action-button" onClick={clearFilters} type="button">清空筛选</button>
            </div>
            <div className="master-batch-row">
              <select className="account-select" onChange={(event) => { setBatchAction(event.target.value); setBatchValue(""); }} value={batchAction}>
                <option value="">选择批量操作</option>
                <option value="set_name">更改姓名</option>
                <option value="set_emp_no">更改人员编号</option>
                <option value="set_department">更改部门</option>
                <option value="set_shift">更改班次</option>
                <option value="set_manager">设置人员类型</option>
                <option value="set_nursing">设置哺乳假</option>
                <option value="set_employee_stats_attendance_source">设置员工考勤统计来源</option>
                <option value="set_manager_stats_attendance_source">设置管理人员考勤统计来源</option>
                <option value="delete">删除</option>
              </select>
              {renderBatchValueControl()}
              <button className="account-action-button account-action-button--danger" onClick={applyBatchAction} type="button">应用到已选</button>
              <button className="account-action-button" onClick={() => setSelectedIds([])} type="button">清空选择</button>
            </div>
            <div className="master-form-text">更改姓名/人员编号使用文本输入；更改部门使用部门选择器；更改班次、人员类型和考勤来源使用下拉。</div>
          </div>

          {loading ? (
            <div className="legacy-table-panel master-table-panel master-table-panel--with-filter">
              <div className="legacy-table-wrap">
                <table className="legacy-table master-table master-table--employees">
                  <tbody>
                    <tr><td className="legacy-table-empty-cell">正在加载员工列表...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <QueryTable
              emptyText="暂无员工数据"
              headers={employeeTableHeaders}
              panelClassName="master-table-panel master-table-panel--with-filter"
              rows={employeeTableRows}
              sortRows={employeeTableSortRows}
              tableClassName="master-table master-table--employees"
            />
          )}
        </section>
      </div>

      {editing ? (
        <div className="master-modal-backdrop">
          <form className="master-modal employee-dept-modal" onSubmit={submitEdit}>
            <div className="master-modal-header">
              <h2>编辑员工</h2>
              <button className="master-modal-close" onClick={() => setEditing(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              {renderEmployeeForm(editForm, setEditForm, "保存", "edit", false)}
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

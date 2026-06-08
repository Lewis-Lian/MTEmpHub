import { FormEvent, useEffect, useState } from "react";

import { buildApiUrl } from "../../api/client";
import { useNotification } from "../../components/feedback/Notification";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
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
import QueryResultPanel from "../../components/query/QueryResultPanel";
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
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<"create" | "import" | null>(null);

  const notification = useNotification();
  const confirm = useConfirm();


  const handleCancelEdit = () => {
    if (editing) {
      notification.info(`已取消编辑员工 ${editing.name}`);
    }
    setEditing(null);
  };

  const handleCloseModal = () => {
    setShowModal(null);
  };

  async function loadRows() {
    setLoading(true);
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
      notification.error(err instanceof Error ? err.message : "员工列表加载失败");
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
    try {
      await createAdminEmployee(form);
      const successMsg = `员工 ${form.name} 创建成功`;
      setForm(emptyEmployeeForm);
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "创建员工失败";
      notification.error(errMsg);
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    try {
      await updateAdminEmployee(editing.id, editForm);
      setEditing(null);
      const successMsg = `员工 ${editForm.name} 保存成功`;
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "保存员工失败";
      notification.error(errMsg);
    }
  }

  async function removeEmployee(row: AdminEmployee) {
    const isConfirmed = await confirm({
      message: `确定删除员工 ${row.emp_no} - ${row.name}？`,
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await deleteAdminEmployee(row.id);
      const successMsg = `员工 ${row.name} 已删除`;
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "删除员工失败";
      notification.error(errMsg);
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
      const warningMsg = "请选择批量操作";
      notification.warning(warningMsg);
      return;
    }
    if (selectedIds.length === 0) {
      const warningMsg = "请先选择员工";
      notification.warning(warningMsg);
      return;
    }
    try {
      await batchAdminEmployees(batchPayload());
      setSelectedIds([]);
      setBatchAction("");
      setBatchValue("");
      const successMsg = "批量操作已完成";
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "批量操作失败";
      notification.error(errMsg);
    }
  }

  async function applyBatchDelete() {
    if (selectedIds.length === 0) {
      const warningMsg = "请先选择员工";
      notification.warning(warningMsg);
      return;
    }
    const isConfirmed = await confirm({
      message: `确定要批量删除已选的 ${selectedIds.length} 名员工吗？此操作不可逆！`,
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await batchAdminEmployees({
        ids: selectedIds,
        action: "delete"
      });
      setSelectedIds([]);
      setBatchAction("");
      setBatchValue("");
      const successMsg = "批量删除已完成";
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "批量删除失败";
      notification.error(errMsg);
    }
  }



  function openEdit(row: AdminEmployee) {
    setEditing(row);
    setEditForm(employeeToForm(row));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!importFile?.name) {
      const warningMsg = "请选择要导入的 xlsx 文件";
      notification.warning(warningMsg);
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
      const warningMsg = "仅支持 .xlsx 文件";
      notification.warning(warningMsg);
      return;
    }

    setIsImporting(true);
    try {
      const result = await importAdminEmployees(importFile);
      form.reset();
      setImportFile(null);
      setImportInputKey((current) => current + 1);
      const successMsg = `导入成功，处理 ${String(result.imported)} 条`;
      notification.success(successMsg);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "导入失败";
      notification.error(errMsg);
    } finally {
      setIsImporting(false);
    }
  }



  function buildFilteredExportUrl() {
    const query = new URLSearchParams();
    filterEmployeeIds.forEach((id) => query.append("ids", String(id)));
    if (typeFilter) {
      query.set("type", typeFilter);
    }
    if (nursingFilter) {
      query.set("is_nursing", nursingFilter);
    }
    if (employeeSourceFilter) {
      query.set("employee_source", employeeSourceFilter);
    }
    if (managerSourceFilter) {
      query.set("manager_source", managerSourceFilter);
    }

    const queryString = query.toString();
    const exportPath = queryString ? `/api/admin/employees/export?${queryString}` : "/api/admin/employees/export";
    return buildApiUrl(exportPath);
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
      <select className="form-select" onChange={(event) => onChange(event.target.value)} value={value} style={{ height: "36px", padding: "0 36px 0 12px", borderRadius: "8px", minWidth: "150px" }}>
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
      <select className="form-select" onChange={(event) => onChange(event.target.value)} value={value} style={{ height: "36px", padding: "0 36px 0 12px", borderRadius: "8px", minWidth: "220px" }}>
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
        <select className="form-select" onChange={(event) => setBatchValue(event.target.value)} value={batchValue} style={{ height: "36px", padding: "0 36px 0 12px", borderRadius: "8px", minWidth: "150px" }}>
          <option value="">选择人员类型</option>
          <option value="0">普通员工</option>
          <option value="1">管理人员</option>
        </select>
      );
    }
    if (batchAction === "set_nursing") {
      return (
        <select className="form-select" onChange={(event) => setBatchValue(event.target.value)} value={batchValue} style={{ height: "36px", padding: "0 36px 0 12px", borderRadius: "8px", minWidth: "150px" }}>
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
        className="form-control"
        disabled={!batchAction || batchAction === "delete"}
        onChange={(event) => setBatchValue(event.target.value)}
        placeholder="操作值"
        value={batchValue}
        style={{ height: "36px", borderRadius: "8px", boxSizing: "border-box" }}
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
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
        {/* 基础信息 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>基础信息</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">人员编号</span>
              <input className="account-input" onChange={(event) => onChange({ ...state, emp_no: event.target.value })} required value={state.emp_no} placeholder="请输入人员编号" />
            </label>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">人员姓名</span>
              <input className="account-input" onChange={(event) => onChange({ ...state, name: event.target.value })} required value={state.name} placeholder="请输入人员姓名" />
            </label>
            <label className="account-field" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <span className="account-field-label">部门名称</span>
              {renderDepartmentSelect(state.dept_name, (value) => onChange({ ...state, dept_name: value }), departmentTarget)}
            </label>
          </div>
        </div>

        {/* 考勤设置 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>考勤规则设置</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label className="account-field" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <span className="account-field-label">班次编号</span>
              {renderShiftSelect(state.shift_no, (value) => onChange({ ...state, shift_no: value }))}
            </label>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">普通员工考勤来源</span>
              {renderSourceSelect(state.employee_stats_attendance_source, (value) => onChange({ ...state, employee_stats_attendance_source: value }))}
              <span className="master-form-text" style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>普通员工有效，管理人员不可编辑</span>
            </label>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">管理人员考勤来源</span>
              {renderSourceSelect(state.manager_stats_attendance_source, (value) => onChange({ ...state, manager_stats_attendance_source: value }))}
              <span className="master-form-text" style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>管理人员有效，普通员工不可编辑</span>
            </label>
          </div>
        </div>

        {/* 附加状态 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>附加状态</h4>
          <div style={{ display: "flex", gap: "32px", padding: "12px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input checked={state.is_manager} onChange={(event) => onChange({ ...state, is_manager: event.target.checked })} type="checkbox" style={{ width: "16px", height: "16px", accentColor: "#2563eb", cursor: "pointer", margin: 0 }} />
              <span style={{ fontSize: "14px", color: "#334155" }}>设为管理人员</span>
            </label>
            <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input checked={state.is_nursing} onChange={(event) => onChange({ ...state, is_nursing: event.target.checked })} type="checkbox" style={{ width: "16px", height: "16px", accentColor: "#2563eb", cursor: "pointer", margin: 0 }} />
              <span style={{ fontSize: "14px", color: "#334155" }}>享受哺乳假</span>
            </label>
          </div>
        </div>

        {showSubmit ? (
          <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
            <button className="account-action-button account-action-button--primary account-primary-button" type="submit" style={{ padding: "8px 28px", borderRadius: "8px", fontWeight: "500", fontSize: "14px", boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)" }}>
              {submitLabel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="master-data-page employee-master-page employee-dashboard-page">
      {/* 顶部控制与摘要行 */}
      <div className="account-top-control-row" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
        marginBottom: "12px",
        marginTop: "16px"
      }}>
        {/* 左侧控制按钮与状态组 */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
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
              新建员工
            </button>
            <button
              className="btn btn-outline-secondary"
              onClick={() => setShowModal("import")}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              导入/导出员工
            </button>
          </div>
          
          <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
          
          {/* 已选计数与刷新按钮，和新建导入及状态栏合在同一行 */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="master-selected-count" style={{ fontSize: "13.5px", color: "var(--ent-text-secondary)", fontWeight: "500", userSelect: "none" }}>
              已选 {selectedIds.length} 人
            </span>
            <button className="account-action-button" onClick={loadRows} type="button" style={{ padding: "6px 12px" }}>
              刷新
            </button>
          </div>
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
            <span style={{ color: "var(--ent-text-secondary)", fontWeight: "500" }}>员工总数：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.length} 人</strong>
          </div>
          <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--ent-text-secondary)" }}>普通员工：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.filter(r => !r.is_manager).length} 人</strong>
          </div>
          <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--ent-text-secondary)" }}>管理人员：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.filter(r => r.is_manager).length} 人</strong>
          </div>
          <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--ent-text-secondary)" }}>哺乳假：</span>
            <strong style={{ color: "var(--ent-primary)" }}>{rows.filter(r => r.is_nursing).length} 人</strong>
          </div>
        </div>
      </div>

      <div className="master-filter-panel" style={{ marginBottom: "12px", position: "relative" }}>
        <div className="master-filter-grid">
          <div className="query-filter-field">
            <label className="form-label">员工筛选器</label>
            <EmployeePicker
              departments={pickerDepartments}
              employees={pickerEmployees}
              onChange={setFilterEmployeeIds}
              selectedIds={filterEmployeeIds}
              showFieldChrome={false}
            />
          </div>
          <div className="query-filter-field">
            <label className="form-label">人员类型</label>
            <select className="form-select" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              <option value="">全部</option>
              <option value="employee">普通员工</option>
              <option value="manager">管理人员</option>
            </select>
          </div>
          <div className="query-filter-field">
            <label className="form-label">哺乳假</label>
            <select className="form-select" onChange={(event) => setNursingFilter(event.target.value)} value={nursingFilter}>
              <option value="">全部</option>
              <option value="1">是</option>
              <option value="0">否</option>
            </select>
          </div>
          <div className="query-filter-field">
            <label className="form-label">员工考勤统计来源</label>
            <select className="form-select" onChange={(event) => setEmployeeSourceFilter(event.target.value)} value={employeeSourceFilter}>
              <option value="">全部</option>
              <option value="employee">员工考勤源文件取值</option>
              <option value="manager">管理人员考勤源文件取值</option>
              <option value="auto_fallback">自动回退</option>
            </select>
          </div>
          <div className="query-filter-field">
            <label className="form-label">管理人员考勤统计来源</label>
            <select className="form-select" onChange={(event) => setManagerSourceFilter(event.target.value)} value={managerSourceFilter}>
              <option value="">全部</option>
              <option value="manager">管理人员考勤源文件取值</option>
              <option value="employee">员工考勤源文件取值</option>
              <option value="auto_fallback">自动回退</option>
            </select>
          </div>
        </div>
        <div className="master-filter-actions" style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="account-action-button" onClick={clearFilters} type="button">清空筛选</button>
        </div>

        {/* 批量操作工具条（作为多选修改器，悬浮显示在筛选器下方） */}
        {selectedIds.length > 0 && (
          <div className="inline-batch-bar" style={{
            position: "absolute",
            bottom: "-24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            background: "var(--ent-bg, #ffffff)",
            border: "1px solid var(--ent-border-strong, #cbd5e1)",
            borderRadius: "8px",
            padding: "8px 20px",
            boxShadow: "var(--ent-shadow-card, 0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.08))",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            boxSizing: "border-box",
            flexWrap: "nowrap",
            whiteSpace: "nowrap",
            maxWidth: "95%"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", userSelect: "none" }}>
              <span style={{ color: "#64748b" }}>已选择</span>
              <strong style={{ color: "var(--ent-primary, #2563eb)", fontSize: "15px", fontWeight: "600" }}>{selectedIds.length}</strong>
              <span style={{ color: "#64748b" }}>人</span>
            </div>

            <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong, #cbd5e1)" }} />

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <select
                className="form-select"
                onChange={(event) => { setBatchAction(event.target.value); setBatchValue(""); }}
                value={batchAction}
                style={{
                  minWidth: "150px",
                  height: "36px",
                  borderRadius: "8px",
                  padding: "0 36px 0 12px",
                  fontSize: "13px",
                }}
              >
                <option value="">选择批量操作</option>
                <option value="set_name">更改姓名</option>
                <option value="set_emp_no">更改人员编号</option>
                <option value="set_department">更改部门</option>
                <option value="set_shift">更改班次</option>
                <option value="set_manager">设置人员类型</option>
                <option value="set_nursing">设置哺乳假</option>
                <option value="set_employee_stats_attendance_source">设置员工考勤统计来源</option>
                <option value="set_manager_stats_attendance_source">设置管理人员考勤统计来源</option>
              </select>
              <div style={{ display: "inline-flex", alignItems: "center", height: "36px" }}>
                {renderBatchValueControl()}
              </div>
            </div>

            <button
              className="account-action-button account-action-button--primary btn btn-primary"
              onClick={applyBatchAction}
              type="button"
              style={{
                borderRadius: "8px",
                height: "36px",
                padding: "0 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                boxShadow: "none",
                fontSize: "13px"
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              应用到已选
            </button>

            <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong, #cbd5e1)" }} />

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                className="account-action-button account-action-button--danger btn btn-danger"
                onClick={applyBatchDelete}
                type="button"
                style={{
                  borderRadius: "8px",
                  height: "36px",
                  padding: "0 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "#ef4444",
                  border: "none",
                  color: "#fff",
                  fontSize: "13px"
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                批量删除
              </button>

              <button
                className="account-action-button"
                onClick={() => { setSelectedIds([]); setBatchAction(""); setBatchValue(""); }}
                type="button"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: "0 4px"
                }}
              >
                清空选择
              </button>
            </div>
          </div>
        )}
      </div>



      <QueryResultPanel>
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
      </QueryResultPanel>





      {editing ? (
        <div className="master-modal-backdrop">
          <form className="master-modal employee-dept-modal" onSubmit={submitEdit} style={{ maxWidth: "650px", width: "100%" }}>
            <div className="master-modal-header">
              <h2>编辑员工</h2>
              <button className="master-modal-close" onClick={handleCancelEdit} type="button">×</button>
            </div>
            <div className="master-modal-body">
              {renderEmployeeForm(editForm, setEditForm, "保存", "edit", false)}
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={handleCancelEdit} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}


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
        <div className="master-modal-container" style={{ width: "100%", maxWidth: "650px", background: "#fff", borderRadius: "12px", padding: "28px", boxSizing: "border-box", position: "relative", maxHeight: "90vh", overflowY: "auto" }}>
          <button className="master-modal-close" onClick={handleCloseModal} style={{ position: "absolute", top: "16px", right: "16px", border: "none", background: "transparent", fontSize: "20px", cursor: "pointer", color: "#64748b" }} type="button">×</button>
          <div style={{ borderBottom: "1px solid var(--ent-border)", paddingBottom: "12px", marginBottom: "16px" }}>
            <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)" }}>新增员工</span>
          </div>
          <form className="account-create-form" onSubmit={submitCreate}>
            {renderEmployeeForm(form, setForm, "创建员工", "create")}
          </form>

        </div>
      </div>

      <div className="master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }} style={{
        position: "fixed",
        left: showModal === "import" ? "0" : "-9999px",
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
        opacity: showModal === "import" ? 1 : 0,
        pointerEvents: showModal === "import" ? "auto" : "none",
        transition: "opacity 0.15s ease"
      }}>
        <div className="master-modal-container" style={{ width: "100%", maxWidth: "600px", background: "#fff", borderRadius: "12px", padding: "28px", boxSizing: "border-box", position: "relative" }}>
          <button className="master-modal-close" onClick={handleCloseModal} style={{ position: "absolute", top: "16px", right: "16px", border: "none", background: "transparent", fontSize: "20px", cursor: "pointer", color: "#64748b" }} type="button">×</button>
          <div style={{ borderBottom: "1px solid var(--ent-border)", paddingBottom: "12px", marginBottom: "20px" }}>
            <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)" }}>数据导入与导出</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* 批量导入专区 */}
            <form className="account-upload-group" encType="multipart/form-data" onSubmit={submitImport} style={{ display: "flex", flexDirection: "column", gap: "16px", margin: 0 }}>
              <div
                style={{
                  padding: "32px 20px",
                  background: isDragOver ? "#eff6ff" : "#f8fafc",
                  border: isDragOver ? "2px dashed #3b82f6" : "1px dashed #cbd5e1",
                  borderRadius: "8px",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                onClick={() => document.getElementById("employee-import-input")?.click()}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  const droppedFile = e.dataTransfer.files?.[0] ?? null;
                  if (droppedFile) {
                    setImportFile(droppedFile);
                  }
                }}
              >
                <div style={{ marginBottom: "16px", color: importFile ? "#3b82f6" : "#64748b" }}>
                  {importFile ? (
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ display: "inline-block" }}
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  ) : (
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ display: "inline-block" }}
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  )}
                </div>
                <div style={{ marginBottom: "8px", fontSize: "15px", color: "#1e293b", fontWeight: "600" }}>
                  {importFile ? importFile.name : "点击选择，或将 Excel 文件拖拽到这里"}
                </div>
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  {importFile ? `大小: ${(importFile.size / 1024).toFixed(1)} KB` : "支持 .xlsx 格式文件"}
                </div>
                <input
                  id="employee-import-input"
                  key={importInputKey}
                  className="account-file-input"
                  name="file"
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <a className="account-action-button" href="/api/admin/employees/template" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13.5px", padding: "8px 16px", borderRadius: "6px", color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", fontWeight: "500", textDecoration: "none" }}>
                  ↓ 下载示例模板
                </a>
                <button className="account-action-button account-action-button--primary" disabled={isImporting} type="submit" style={{ padding: "8px 32px", borderRadius: "8px", fontWeight: "500", fontSize: "14px", boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)" }}>
                  {isImporting ? "导入中..." : "开始导入"}
                </button>
              </div>
            </form>

            <div style={{ height: "1px", background: "#e2e8f0" }}></div>

            {/* 数据导出专区 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>数据导出</h4>
              <div style={{ display: "flex", gap: "12px" }}>
                <a className="account-action-button" href="/api/admin/employees/export" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", borderRadius: "6px", fontSize: "13.5px", textDecoration: "none" }}>导出全部主数据</a>
                <a className="account-action-button" href={buildFilteredExportUrl()} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", borderRadius: "6px", fontSize: "13.5px", textDecoration: "none" }}>导出当前筛选结果</a>
              </div>
            </div>

            <div className="panel-note" style={{ margin: 0, padding: "12px 16px", background: "#fffbeb", borderRadius: "8px", color: "#92400e", fontSize: "13px", border: "1px solid #fde68a", lineHeight: "1.6" }}>
              <strong style={{ color: "#78350f" }}>模板列要求：</strong><br/>
              人员编号、人员姓名、部门名称、班次编号、是否管理人员、是否哺乳假、员工考勤统计来源、管理人员考勤统计来源。
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

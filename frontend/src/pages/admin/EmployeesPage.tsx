import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { buildApiUrl } from "../../api/client";
import LoadingState from "../../components/feedback/LoadingState";
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
  reinstateAdminEmployee,
  resignAdminEmployee,
  updateAdminEmployee,
} from "../../api/admin";
import type { EmployeeStatusFilter } from "../../api/admin";

import DepartmentPicker from "../../components/query/DepartmentPicker";
import EmployeeBatchToolbar from "../../components/admin/EmployeeBatchToolbar";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
// 本页 main 复用 employee-dashboard-page 类名，下拉框样式全部来自查询页共享样式；
// 不显式引入时，直接进入本页（未先访问过查询页）会缺失这些样式
import "../query/dashboard-shared.css";
import "./employee-management.css";
import "./admin-management-shared.css";
import type { AdminDepartment, AdminEmployee, AdminShift } from "../../types/admin";
import type { DepartmentOption, QueryEmployee } from "../../types/query";

type EmployeeFormState = {
  emp_no: string;
  name: string;
  card_no: string;
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
  card_no: "",
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

const resignPreviewLabelStyle = { display: "inline-block", minWidth: "72px", color: "#94a3b8" };
const resignPreviewValueStyle = { color: "#334155", fontWeight: 600 };

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function cardNoMatches(cardNo: string | null | undefined, lookup: string): boolean {
  if (!cardNo || !lookup) {
    return false;
  }
  // 全零卡号去零后为空串，保留原值避免与空值互相误匹配
  const stripLeadingZeros = (value: string) => value.replace(/^0+/, "") || value;
  return stripLeadingZeros(cardNo) === stripLeadingZeros(lookup);
}

function employeeToForm(row: AdminEmployee): EmployeeFormState {
  return {
    emp_no: row.emp_no,
    name: row.name,
    card_no: row.card_no ?? "",
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
  const [employmentFilter, setEmploymentFilter] = useState<EmployeeStatusFilter>("active");
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
  const [showResignModal, setShowResignModal] = useState(false);
  const [resignEmpNo, setResignEmpNo] = useState("");
  const resignEmpNoInputRef = useRef<HTMLInputElement>(null);
  const [resignDate, setResignDate] = useState(() => todayLocalDate());
  const [isResigning, setIsResigning] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

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
        fetchAdminEmployees("all"),
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
    if (normalizedKeyword && !`${row.emp_no} ${row.name} ${row.card_no ?? ""}`.toLowerCase().includes(normalizedKeyword)) {
      return false;
    }
    if (employmentFilter === "active" && row.resigned_at) {
      return false;
    }
    if (employmentFilter === "resigned" && !row.resigned_at) {
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
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    const visibleIds = filteredRows.map((row) => row.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return Array.from(next);
    });
  }

  function clearFilters() {
    setKeyword("");
    setTypeFilter("");
    setNursingFilter("");
    setEmploymentFilter("active");
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

  function openResignModal(empNo: string) {
    setResignEmpNo(empNo);
    setResignDate(todayLocalDate());
    setShowResignModal(true);
  }

  async function submitResign(event: FormEvent) {
    event.preventDefault();
    const lookupValue = resignEmpNo.trim();
    if (!lookupValue) {
      notification.warning("请输入人员编号、姓名或卡号");
      return;
    }
    if (!resignDate) {
      notification.warning("请选择离职日期");
      return;
    }
    const matches = rows.filter((row) => row.emp_no === lookupValue || row.name === lookupValue || cardNoMatches(row.card_no, lookupValue));
    if (matches.length > 1) {
      notification.warning("该姓名对应多名员工，请输入人员编号精确办理");
      return;
    }
    const empNo = matches.length === 1 ? matches[0].emp_no : lookupValue;
    const isConfirmed = await confirm({
      message: `确定为员工 ${empNo}${matches.length === 1 ? ` ${matches[0].name}` : ""} 办理离职（离职日期 ${resignDate}）？办理后其关联账号将被禁用，各查询与统计页面不再显示该员工。`,
      type: "danger",
    });
    if (!isConfirmed) {
      return;
    }
    setIsResigning(true);
    try {
      const result = await resignAdminEmployee({ emp_no: empNo, resigned_at: resignDate });
      notification.success(`员工 ${result.employee.name} 已办理离职`);
      setResignEmpNo("");
      resignEmpNoInputRef.current?.focus();
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "办理离职失败";
      notification.error(errMsg);
    } finally {
      setIsResigning(false);
    }
  }

  async function reinstateEmployee(row: AdminEmployee) {
    const isConfirmed = await confirm({
      message: `确定恢复员工 ${row.emp_no} - ${row.name} 为在职？其关联账号将自动解除禁用。`,
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await reinstateAdminEmployee(row.id);
      notification.success(`员工 ${row.name} 已恢复在职`);
      await loadRows();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "恢复在职失败";
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

  function openRowMenu(rowId: number, event: ReactMouseEvent<HTMLButtonElement>) {
    const triggerRect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: triggerRect.bottom + 4,
      left: Math.max(8, triggerRect.right - 140),
    });
    setOpenMenuId(rowId);
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
    if (employmentFilter !== "all") {
      query.set("status", employmentFilter);
    }
    if (keyword.trim()) {
      query.set("keyword", keyword.trim());
    }
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
          aria-label="选择当前筛选结果"
          checked={filteredRows.length > 0 && filteredRows.every((row) => selectedIds.includes(row.id))}
          onChange={(event) => toggleVisibleSelection(event.target.checked)}
          type="checkbox"
        />
      ),
      sortable: false,
    },
    "ID",
    "人员编号",
    "人员姓名",
    "卡号",
    "人员类型",
    "在职状态",
    "哺乳假",
    "员工考勤统计来源",
    "管理人员考勤统计来源",
    "部门名称",
    "班次",
    { label: "操作", sortable: false },
  ];
  const employmentLabel = (row: AdminEmployee) => (row.resigned_at ? `已离职 ${row.resigned_at}` : "在职");

  const resignLookupValue = resignEmpNo.trim();
  const resignMatches = resignLookupValue
    ? rows.filter((row) => row.emp_no === resignLookupValue || row.name === resignLookupValue || cardNoMatches(row.card_no, resignLookupValue))
    : [];

  function renderRowActions(row: AdminEmployee) {
    const menuOpen = openMenuId === row.id;
    const rowMenu = menuOpen && menuPosition
      ? createPortal(
          <>
            <div
              onClick={() => setOpenMenuId(null)}
              style={{ position: "fixed", inset: 0, zIndex: "calc(var(--z-dropdown, 1200) - 1)" }}
            />
            <div
              className="employee-row-actions-menu"
              style={{
                position: "fixed",
                top: menuPosition.top,
                left: menuPosition.left,
                zIndex: "var(--z-dropdown, 1200)",
              }}
            >
              {row.resigned_at ? (
                <button
                  className="employee-row-menu-item employee-row-menu-item--success"
                  onClick={() => {
                    setOpenMenuId(null);
                    void reinstateEmployee(row);
                  }}
                  type="button"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <polyline points="17 11 19 13 23 9" />
                  </svg>
                  <span>恢复在职</span>
                </button>
              ) : (
                <button
                  className="employee-row-menu-item"
                  onClick={() => {
                    setOpenMenuId(null);
                    openResignModal(row.emp_no);
                  }}
                  type="button"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>办理离职</span>
                </button>
              )}
              <div className="employee-row-menu-divider" />
              <button
                className="employee-row-menu-item employee-row-menu-item--danger"
                onClick={() => {
                  setOpenMenuId(null);
                  void removeEmployee(row);
                }}
                type="button"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>删除</span>
              </button>
            </div>
          </>,
          document.body,
        )
      : null;
    return (
      <div className="toolbar employee-row-actions" style={{ position: "relative" }}>
        <div className="employee-row-action-group">
          <button className="employee-row-action-edit" onClick={() => openEdit(row)} type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>编辑</span>
          </button>
          <button
            aria-expanded={menuOpen}
            aria-label="员工操作菜单"
            className="employee-row-menu-trigger"
            onClick={(event) => {
              if (menuOpen) {
                setOpenMenuId(null);
              } else {
                openRowMenu(row.id, event);
              }
            }}
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        {rowMenu}
      </div>
    );
  }

  const employeeTableRows = loading
    ? []
    : filteredRows.map((row) => [
        <input
          aria-label="选择员工行"
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleSelected(row.id)}
          type="checkbox"
        />,
        row.id,
        row.emp_no,
        row.name,
        row.card_no || "-",
        row.is_manager ? "管理人员" : "普通员工",
        employmentLabel(row),
        row.is_nursing ? "是" : "否",
        attendanceSourceLabels[row.employee_stats_attendance_source ?? ""] ?? "-",
        attendanceSourceLabels[row.manager_stats_attendance_source ?? ""] ?? "-",
        row.dept_name || "-",
        row.shift_no ? `${row.shift_no}${row.shift_name ? ` - ${row.shift_name}` : ""}` : "不绑定",
        renderRowActions(row),
      ]);
  const employeeTableSortRows = loading
    ? []
    : filteredRows.map((row) => [
        "",
        row.id,
        row.emp_no,
        row.name,
        row.card_no || "-",
        row.is_manager ? "管理人员" : "普通员工",
        employmentLabel(row),
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
        <select aria-label="设置人员类型" className="form-select employee-batch-value-control" onChange={(event) => setBatchValue(event.target.value)} value={batchValue}>
          <option value="">选择人员类型</option>
          <option value="0">普通员工</option>
          <option value="1">管理人员</option>
        </select>
      );
    }
    if (batchAction === "set_nursing") {
      return (
        <select aria-label="设置哺乳假" className="form-select employee-batch-value-control" onChange={(event) => setBatchValue(event.target.value)} value={batchValue}>
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
        aria-label="批量设置值"
        className="form-control employee-batch-value-control"
        disabled={!batchAction || batchAction === "delete"}
        onChange={(event) => setBatchValue(event.target.value)}
        placeholder="请输入要设置的值"
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
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
        {/* 基础信息 */}
        <div className="admin-stack">
          <h4 className="admin-modal-title">基础信息</h4>
          <div className="admin-form-grid">
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">人员编号</span>
              <input className="account-input" onChange={(event) => onChange({ ...state, emp_no: event.target.value })} required value={state.emp_no} placeholder="请输入人员编号" />
            </label>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">人员姓名</span>
              <input className="account-input" onChange={(event) => onChange({ ...state, name: event.target.value })} required value={state.name} placeholder="请输入人员姓名" />
            </label>
            <label className="account-field" style={{ margin: 0 }}>
              <span className="account-field-label">卡号</span>
              <input className="account-input" onChange={(event) => onChange({ ...state, card_no: event.target.value })} value={state.card_no} placeholder="选填，员工唯一" />
            </label>
            <label className="account-field admin-form-grid-wide">
              <span className="account-field-label">部门名称</span>
              {renderDepartmentSelect(state.dept_name, (value) => onChange({ ...state, dept_name: value }), departmentTarget)}
            </label>
          </div>
        </div>

        {/* 考勤设置 */}
        <div className="admin-stack">
          <h4 className="admin-modal-title">考勤规则设置</h4>
          <div className="admin-form-grid">
            <label className="account-field admin-form-grid-wide">
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
        <div className="admin-stack">
          <h4 className="admin-modal-title">附加状态</h4>
          <div style={{ display: "flex", gap: "32px", padding: "12px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input checked={state.is_manager} onChange={(event) => onChange({ ...state, is_manager: event.target.checked })} type="checkbox" style={{ width: "16px", height: "16px", accentColor: "#2563eb", cursor: "pointer", margin: 0 }} />
              <span className="admin-text">设为管理人员</span>
            </label>
            <label className="master-check-option" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input checked={state.is_nursing} onChange={(event) => onChange({ ...state, is_nursing: event.target.checked })} type="checkbox" style={{ width: "16px", height: "16px", accentColor: "#2563eb", cursor: "pointer", margin: 0 }} />
              <span className="admin-text">享受哺乳假</span>
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

  const hasActiveSecondaryFilters =
    employmentFilter !== "active" ||
    Boolean(keyword.trim()) ||
    Boolean(typeFilter) ||
    Boolean(nursingFilter) ||
    Boolean(employeeSourceFilter) ||
    Boolean(managerSourceFilter);

  return (
    <main className="admin-management-page employee-management-page master-data-page employee-master-page employee-dashboard-page">
      {/* 极光动态流光背景球 (参考查询页设计，赋予磨砂玻璃深度与生动折射) */}
      <div className="qh-glow-sphere sphere-1" />
      <div className="qh-glow-sphere sphere-2" />
      <div className="qh-glow-sphere sphere-3" />

      {/* 顶部控制栏 (Top Executive Control Rail) */}
      <header className="emp-top-rail">
        <div className="emp-top-left">
          <div className="emp-title-group">
            <span className="emp-eyebrow">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Personnel Directory
            </span>
            <h1 className="emp-main-title">员工主数据管理</h1>
          </div>

          {/* 指标胶囊群 */}
          <div className="emp-metrics-capsules">
            <span className="emp-stat-pill emp-stat-pill--total" title="员工总数">
              总计 <strong>{rows.length}</strong>
            </span>
            <span className="emp-stat-pill emp-stat-pill--active" title="在职员工">
              <span className="emp-stat-dot" />
              在职 <strong>{rows.filter((r) => !r.resigned_at).length}</strong>
            </span>
            <span className="emp-stat-pill emp-stat-pill--regular" title="普通员工">
              普通 <strong>{rows.filter((r) => !r.is_manager).length}</strong>
            </span>
            <span className="emp-stat-pill emp-stat-pill--manager" title="管理人员">
              管理 <strong>{rows.filter((r) => r.is_manager).length}</strong>
            </span>
            <span className="emp-stat-pill emp-stat-pill--nursing" title="享受哺乳假">
              哺乳 <strong>{rows.filter((r) => r.is_nursing).length}</strong>
            </span>
            {rows.filter((r) => r.resigned_at).length > 0 ? (
              <span className="emp-stat-pill emp-stat-pill--resigned" title="已离职员工">
                离职 <strong>{rows.filter((r) => r.resigned_at).length}</strong>
              </span>
            ) : null}
          </div>
        </div>

        {/* macOS Dock 风格悬浮操作栏 */}
        <div className="emp-dock-container account-panel-selector">
          <div className="emp-dock-bar">
            <button
              className="emp-dock-item emp-dock-item--create btn btn-outline-secondary"
              onClick={() => setShowModal("create")}
              title="新建员工档案"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>新建员工</span>
            </button>

            <button
              className="emp-dock-item btn btn-outline-secondary"
              onClick={() => setShowModal("import")}
              title="导入/导出员工 Excel"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>导入/导出员工</span>
            </button>

            <button
              className="emp-dock-item btn btn-outline-secondary"
              onClick={() => openResignModal("")}
              title="办理员工离职"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>办理离职</span>
            </button>

            <div className="emp-dock-divider" aria-hidden="true" />

            <button
              className="emp-dock-item account-action-button"
              onClick={loadRows}
              title="刷新员工数据"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>刷新</span>
            </button>

            <div className="emp-dock-divider" aria-hidden="true" />

            <div className="emp-dock-selection-badge master-selected-count">
              已选 {selectedIds.length} 人
            </div>
          </div>
        </div>
      </header>

      {/* 紧凑型筛选面板 (参考查询页设计：默认员工选择器，点击展开才显示其余筛选条件，全毛玻璃质感) */}
      <div className="emp-filter-rail" style={{ position: "relative" }}>
        {/* 第一行：主要筛选器（员工选择器）与操作组 */}
        <div className="emp-filter-primary-row">
          <div className="emp-filter-picker-group query-filter-field">
            <label className="emp-filter-label form-label">员工筛选器</label>
            <div className="emp-filter-picker-wrap">
              <EmployeePicker
                departments={pickerDepartments}
                employees={pickerEmployees}
                onChange={setFilterEmployeeIds}
                selectedIds={filterEmployeeIds}
                showFieldChrome={false}
              />
            </div>
          </div>

          <div className="emp-filter-actions-group master-filter-actions">
            <button
              className={`emp-filter-toggle-btn${isFilterExpanded ? " is-expanded" : ""}`}
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              type="button"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isFilterExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{isFilterExpanded ? "收起筛选" : "展开其余筛选"}</span>
              {hasActiveSecondaryFilters ? (
                <span className="emp-filter-badge-dot" title="已有生效的附加筛选条件" />
              ) : null}
            </button>

            <button className="emp-btn emp-btn--secondary account-action-button" onClick={clearFilters} type="button">
              清空筛选
            </button>
          </div>
        </div>

        {/* 第二行：点开展开按钮才显示的其余筛选条件 */}
        <div className={`emp-filter-secondary-grid master-filter-grid${isFilterExpanded ? " is-open" : " is-closed"}`} style={{ display: isFilterExpanded ? "grid" : "none" }}>
          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label" htmlFor="employmentFilterSelect">在职状态</label>
            <select
              className="emp-filter-select form-select"
              id="employmentFilterSelect"
              onChange={(event) => setEmploymentFilter(event.target.value as EmployeeStatusFilter)}
              value={employmentFilter}
            >
              <option value="active">在职</option>
              <option value="resigned">已离职</option>
              <option value="all">全部</option>
            </select>
          </div>

          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label" htmlFor="employeeKeywordInput">关键词</label>
            <input
              className="emp-filter-input form-control"
              id="employeeKeywordInput"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="工号 / 姓名"
              value={keyword}
            />
          </div>

          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label">人员类型</label>
            <select className="emp-filter-select form-select" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              <option value="">全部</option>
              <option value="employee">普通员工</option>
              <option value="manager">管理人员</option>
            </select>
          </div>

          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label">哺乳假</label>
            <select className="emp-filter-select form-select" onChange={(event) => setNursingFilter(event.target.value)} value={nursingFilter}>
              <option value="">全部</option>
              <option value="1">是</option>
              <option value="0">否</option>
            </select>
          </div>

          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label">员工考勤统计来源</label>
            <select className="emp-filter-select form-select" onChange={(event) => setEmployeeSourceFilter(event.target.value)} value={employeeSourceFilter}>
              <option value="">全部</option>
              <option value="employee">员工考勤源文件取值</option>
              <option value="manager">管理人员考勤源文件取值</option>
              <option value="auto_fallback">自动回退</option>
            </select>
          </div>

          <div className="emp-filter-field query-filter-field">
            <label className="emp-filter-label form-label">管理人员考勤统计来源</label>
            <select className="emp-filter-select form-select" onChange={(event) => setManagerSourceFilter(event.target.value)} value={managerSourceFilter}>
              <option value="">全部</option>
              <option value="manager">管理人员考勤源文件取值</option>
              <option value="employee">员工考勤源文件取值</option>
              <option value="auto_fallback">自动回退</option>
            </select>
          </div>
        </div>

        {/* 批量操作工具栏 */}
        {selectedIds.length > 0 ? (
          <div style={{ marginTop: "6px", paddingTop: "8px", borderTop: "1px solid rgba(226, 232, 240, 0.7)" }}>
            <EmployeeBatchToolbar
              batchAction={batchAction}
              onApply={applyBatchAction}
              onBatchActionChange={(action) => { setBatchAction(action); setBatchValue(""); }}
              onClear={() => { setSelectedIds([]); setBatchAction(""); setBatchValue(""); }}
              onDelete={applyBatchDelete}
              renderValueControl={renderBatchValueControl}
              selectedCount={selectedIds.length}
            />
          </div>
        ) : null}
      </div>

      {/* 数据表格面板 */}
      <div className="emp-table-window admin-management-table">
        <QueryResultPanel>
          {loading ? (
            <LoadingState message="正在加载员工列表..." variant="table" contentOnly headers={employeeTableHeaders.map((header) => typeof header === "string" ? header : typeof header.label === "string" ? header.label : "")} />
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
      </div>

      {/* 编辑员工弹窗 */}
      {editing ? (
        <div className="emp-modal-backdrop master-modal-backdrop">
          <form className="emp-modal-window master-modal employee-dept-modal" onSubmit={submitEdit} style={{ maxWidth: "650px", width: "100%" }}>
            <div className="emp-modal-header master-modal-header">
              <div className="emp-modal-title-wrap">
                <span className="emp-modal-kicker">EMPLOYEE PROFILE</span>
                <h2 className="emp-modal-title">编辑员工</h2>
              </div>
              <button className="emp-modal-close-btn master-modal-close" onClick={handleCancelEdit} type="button">×</button>
            </div>
            <div className="emp-modal-body master-modal-body">
              {renderEmployeeForm(editForm, setEditForm, "保存", "edit", false)}
            </div>
            <div className="emp-modal-footer master-modal-footer admin-management-modal-footer">
              <button className="emp-btn emp-btn--secondary account-action-button" onClick={handleCancelEdit} type="button">取消</button>
              <button className="emp-btn emp-btn--primary account-action-button account-action-button--primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {/* 新增员工弹窗 */}
      {showModal === "create" ? <div
        className="emp-modal-backdrop master-modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
      >
        <div className="emp-modal-window master-modal-container" style={{ width: "100%", maxWidth: "650px" }}>
          <div className="emp-modal-header">
            <div className="emp-modal-title-wrap">
              <span className="emp-modal-kicker">NEW EMPLOYEE</span>
              <h2 className="emp-modal-title">
                <span>新增员工</span>
              </h2>
            </div>
            <button className="emp-modal-close-btn master-modal-close admin-modal-close" onClick={handleCloseModal} type="button">×</button>
          </div>
          <div className="emp-modal-body">
            <form className="account-create-form" onSubmit={submitCreate}>
              {renderEmployeeForm(form, setForm, "创建员工", "create")}
            </form>
          </div>
        </div>
      </div> : null}

      {/* 导入/导出弹窗 */}
      {showModal === "import" ? <div
        className="emp-modal-backdrop master-modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
      >
        <div className="emp-modal-window master-modal-container" style={{ width: "100%", maxWidth: "600px" }}>
          <div className="emp-modal-header">
            <div className="emp-modal-title-wrap">
              <span className="emp-modal-kicker">DATA TRANSFER</span>
              <h2 className="emp-modal-title">
                <span>数据导入与导出</span>
              </h2>
            </div>
            <button className="emp-modal-close-btn master-modal-close admin-modal-close" onClick={handleCloseModal} type="button">×</button>
          </div>

          <div className="emp-modal-body admin-stack-lg">
            {/* 批量导入专区 */}
            <form className="account-upload-group" encType="multipart/form-data" onSubmit={submitImport} style={{ display: "flex", flexDirection: "column", gap: "16px", margin: 0 }}>
              <div
                style={{
                  padding: "32px 20px",
                  background: isDragOver ? "#eff6ff" : "rgba(248, 250, 252, 0.75)",
                  border: isDragOver ? "2px dashed var(--emp-primary)" : "1px dashed rgba(203, 213, 225, 0.9)",
                  borderRadius: "14px",
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
                <div style={{ marginBottom: "16px", color: importFile ? "var(--emp-primary)" : "#64748b" }}>
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
                <a className="emp-btn emp-btn--secondary account-action-button" href="/api/admin/employees/template" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13px", padding: "0 16px", color: "var(--emp-primary)", textDecoration: "none" }}>
                  ↓ 下载示例模板
                </a>
                <button className={`emp-btn emp-btn--primary account-action-button account-action-button--primary${isImporting ? " is-loading" : ""}`} disabled={isImporting} type="submit" style={{ padding: "0 28px" }}>
                  {isImporting ? "导入中..." : "开始导入"}
                </button>
              </div>
            </form>

            <div style={{ height: "1px", background: "rgba(226, 232, 240, 0.8)" }}></div>

            {/* 数据导出专区 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>数据导出</h4>
              <div style={{ display: "flex", gap: "12px" }}>
                <a className="emp-btn emp-btn--secondary account-action-button" href="/api/admin/employees/export" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>导出全部主数据</a>
                <a className="emp-btn emp-btn--secondary account-action-button" href={buildFilteredExportUrl()} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>导出当前筛选结果</a>
              </div>
            </div>

            <div className="panel-note" style={{ margin: 0, padding: "12px 16px", background: "var(--emp-warning-light)", borderRadius: "10px", color: "#92400e", fontSize: "13px", border: "1px solid var(--emp-warning-border)", lineHeight: "1.6" }}>
              <strong style={{ color: "#78350f" }}>模板列要求：</strong><br/>
              人员编号、人员姓名、卡号（选填；文件包含此列时留空将清空已有卡号）、部门名称、班次编号、是否管理人员、是否哺乳假、员工考勤统计来源、管理人员考勤统计来源。
            </div>
          </div>
        </div>
      </div> : null}

      {/* 办理离职弹窗 */}
      {showResignModal ? (
        <div
          className="emp-modal-backdrop master-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setShowResignModal(false); }}
        >
          <form
            className="emp-modal-window master-modal-container"
            onSubmit={submitResign}
            style={{ width: "100%", maxWidth: "460px" }}
          >
            <div className="emp-modal-header">
              <div className="emp-modal-title-wrap">
                <span className="emp-modal-kicker">PERSONNEL CHANGE</span>
                <h2 className="emp-modal-title">办理离职</h2>
              </div>
              <button className="emp-modal-close-btn master-modal-close admin-modal-close" onClick={() => setShowResignModal(false)} type="button">×</button>
            </div>
            <div className="emp-modal-body admin-stack">
              <label className="account-field" style={{ margin: 0 }}>
                <span className="account-field-label">离职人员编号/姓名/卡号</span>
                <input
                  className="account-input"
                  id="resignEmpNo"
                  onChange={(event) => setResignEmpNo(event.target.value)}
                  placeholder="请输入人员编号、姓名或卡号"
                  ref={resignEmpNoInputRef}
                  required
                  value={resignEmpNo}
                />
              </label>
              {resignLookupValue ? (
                <div
                  data-testid="resign-employee-preview"
                  style={{
                    padding: "12px 16px",
                    background: "rgba(241, 245, 249, 0.7)",
                    border: "1px solid rgba(226, 232, 240, 0.9)",
                    borderRadius: "10px",
                    fontSize: "13px",
                    lineHeight: "1.9",
                    color: "#475569",
                  }}
                >
                  {resignMatches.length === 1 ? (
                    <>
                      <div>
                        <span style={resignPreviewLabelStyle}>人员编号</span>
                        <strong style={resignPreviewValueStyle}>{resignMatches[0].emp_no}</strong>
                      </div>
                      <div>
                        <span style={resignPreviewLabelStyle}>姓名</span>
                        <strong style={resignPreviewValueStyle}>{resignMatches[0].name}</strong>
                      </div>
                      <div>
                        <span style={resignPreviewLabelStyle}>部门</span>
                        <strong style={resignPreviewValueStyle}>{resignMatches[0].dept_name || "未绑定部门"}</strong>
                      </div>
                      <div>
                        <span style={resignPreviewLabelStyle}>人员类型</span>
                        <strong style={resignPreviewValueStyle}>{resignMatches[0].is_manager ? "管理人员" : "普通员工"}</strong>
                      </div>
                      <div>
                        <span style={resignPreviewLabelStyle}>在职状态</span>
                        {resignMatches[0].resigned_at ? (
                          <strong style={{ color: "#dc2626", fontWeight: 600 }}>已于 {resignMatches[0].resigned_at} 离职，无需重复办理</strong>
                        ) : (
                          <strong style={resignPreviewValueStyle}>在职</strong>
                        )}
                      </div>
                    </>
                  ) : resignMatches.length > 1 ? (
                    <>
                      <div style={{ color: "#dc2626", fontWeight: 600, marginBottom: "4px" }}>该姓名对应 {resignMatches.length} 名员工，请输入人员编号精确办理：</div>
                      {resignMatches.map((row) => (
                        <div key={row.id}>
                          <strong style={resignPreviewValueStyle}>{row.emp_no}</strong>
                          {` ${row.name} · ${row.dept_name || "未绑定部门"} · ${row.resigned_at ? `已于 ${row.resigned_at} 离职` : "在职"}`}
                        </div>
                      ))}
                    </>
                  ) : (
                    <span style={{ color: "#dc2626" }}>未找到编号/姓名/卡号为 {resignLookupValue} 的员工，请核对后重新输入</span>
                  )}
                </div>
              ) : null}
              <label className="account-field" style={{ margin: 0 }}>
                <span className="account-field-label">离职日期</span>
                <input
                  className="account-input"
                  id="resignDate"
                  onChange={(event) => setResignDate(event.target.value)}
                  required
                  type="date"
                  value={resignDate}
                />
              </label>
              <div className="panel-note" style={{ margin: 0, padding: "12px 16px", background: "var(--emp-warning-light)", borderRadius: "10px", color: "#92400e", fontSize: "13px", border: "1px solid var(--emp-warning-border)", lineHeight: "1.6" }}>
                办理后：其关联登录账号将被自动禁用，各查询与统计页面不再显示该员工；可在"已离职"筛选下恢复在职。
              </div>
            </div>
            <div className="emp-modal-footer admin-management-modal-footer">
              <button className="emp-btn emp-btn--secondary account-action-button" onClick={() => setShowResignModal(false)} type="button">取消</button>
              <button
                className="emp-btn emp-btn--primary account-action-button account-action-button--primary"
                disabled={isResigning}
                type="submit"
              >
                {isResigning ? "提交中..." : "确认离职"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

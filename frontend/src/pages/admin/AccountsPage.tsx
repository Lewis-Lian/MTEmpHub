import { useEffect, useMemo, useRef, useState } from "react";

import { fetchAdminDepartments, fetchAdminEmployees } from "../../api/admin";
import { apiRequest } from "../../api/client";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import DepartmentMultiPicker from "../../components/query/DepartmentMultiPicker";
import EmployeePicker from "../../components/query/EmployeePicker";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import type { AdminDepartment, AdminEmployee } from "../../types/admin";
import type { DepartmentOption, QueryEmployee } from "../../types/query";
import { useNotification } from "../../components/feedback/Notification";

interface AccountUser {
  id: number;
  username: string;
  role: "admin" | "readonly";
  profile_emp_no: string;
  profile_name: string;
  profile_dept_id: number | null;
  profile_department: {
    id: number;
    dept_no?: string;
    dept_name: string;
  } | null;
  created_at: string | null;
  page_permissions: Record<string, boolean>;
  emp_ids: number[];
  dept_ids: number[];
  employees: Array<{ id: number; emp_no: string; name: string; dept_name?: string }>;
  departments: Array<{ id: number; dept_name: string }>;
}

const permissionCatalog = [
  { key: "query_home", label: "首页", group: "通用" },
  { key: "individual_attendance", label: "个人考勤查询", group: "通用" },
  { key: "manager_query", label: "管理人员考勤数据查询", group: "管理人员" },
  { key: "manager_overtime_query", label: "查询加班", group: "管理人员" },
  { key: "manager_annual_leave_query", label: "查询年休", group: "管理人员" },
  { key: "manager_department_hours_query", label: "管理人员部门工时查询", group: "管理人员" },
  { key: "employee_dashboard", label: "员工考勤数据查询", group: "员工" },
  { key: "abnormal_query", label: "员工异常查询", group: "员工" },
  { key: "punch_records", label: "员工打卡数据查询", group: "员工" },
  { key: "department_hours_query", label: "员工部门工时查询", group: "员工" },
  { key: "summary_download", label: "汇总下载", group: "员工" },
] as const;

const PERMISSION_GROUPS = [
  { key: "通用", title: "通用功能" },
  { key: "管理人员", title: "管理人员考勤" },
  { key: "员工", title: "员工考勤" },
] as const;

const allPermissionKeys = permissionCatalog.map((item) => item.key);
const ACCOUNT_LIST_PATH = "/api/admin/accounts";

export default function AccountsPage() {
  const notification = useNotification();
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"readonly" | "admin">("readonly");
  const [createEmpIds, setCreateEmpIds] = useState<number[]>([]);
  const [createDeptIds, setCreateDeptIds] = useState<number[]>([]);
  const [createPermissionKeys, setCreatePermissionKeys] = useState<string[]>(allPermissionKeys);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [createProfileEmployeeId, setCreateProfileEmployeeId] = useState<number | null>(null);
  const [createProfileEmpNo, setCreateProfileEmpNo] = useState("");
  const [createProfileName, setCreateProfileName] = useState("");
  const [createProfileDeptId, setCreateProfileDeptId] = useState("");

  const [filterEmpIds, setFilterEmpIds] = useState<number[]>([]);
  const [filterRole, setFilterRole] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const [editingUser, setEditingUser] = useState<AccountUser | null>(null);
  const [editProfileEmployeeId, setEditProfileEmployeeId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"readonly" | "admin">("readonly");
  const [editProfileEmpNo, setEditProfileEmpNo] = useState("");
  const [editProfileName, setEditProfileName] = useState("");
  const [editProfileDeptId, setEditProfileDeptId] = useState("");
  const [editEmpIds, setEditEmpIds] = useState<number[]>([]);
  const [editDeptIds, setEditDeptIds] = useState<number[]>([]);
  const [editPermissionKeys, setEditPermissionKeys] = useState<string[]>(allPermissionKeys);

  const [batchPermissionOpen, setBatchPermissionOpen] = useState(false);

  const [batchRoleOpen, setBatchRoleOpen] = useState(false);
  const [batchRole, setBatchRole] = useState<"" | "admin" | "readonly">("");
  const [batchEmployeeOpen, setBatchEmployeeOpen] = useState(false);
  const [batchEmployeeIds, setBatchEmployeeIds] = useState<number[]>([]);
  const [batchDepartmentOpen, setBatchDepartmentOpen] = useState(false);
  const [batchDepartmentIds, setBatchDepartmentIds] = useState<number[]>([]);
  const [batchPermissionKeys, setBatchPermissionKeys] = useState<string[]>(allPermissionKeys);

  const [batchPasswordOpen, setBatchPasswordOpen] = useState(false);
  const [batchPassword, setBatchPassword] = useState("");
  const [managerPasswordOpen, setManagerPasswordOpen] = useState(false);
  const [managerPassword, setManagerPassword] = useState("");
  const [resetTargetUser, setResetTargetUser] = useState<AccountUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    void loadPage();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadPage() {
    setLoading(true);
    setLoadError("");
    try {
      const [userRows, employeeRows, departmentRows] = await Promise.all([
        apiRequest<AccountUser[]>(ACCOUNT_LIST_PATH),
        fetchAdminEmployees(),
        fetchAdminDepartments(),
      ]);
      if (!mountedRef.current) return;
      setUsers(Array.isArray(userRows) ? userRows : []);
      setEmployees(employeeRows);
      setDepartments(departmentRows);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(error instanceof Error ? error.message : "账号管理加载失败");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function refreshUsers() {
    const rows = await apiRequest<AccountUser[]>(ACCOUNT_LIST_PATH);
    setUsers(Array.isArray(rows) ? rows : []);
    setSelectedUserIds((current) => current.filter((id) => rows.some((user) => user.id === id)));
  }

  const pickerEmployees: QueryEmployee[] = useMemo(
    () =>
      employees.map((row) => ({
        id: row.id,
        emp_no: row.emp_no,
        name: row.name,
        dept_id: row.dept_id ?? null,
        dept_name: row.dept_name ?? "",
        is_manager: Boolean(row.is_manager),
      })),
    [employees],
  );
  const pickerDepartments: DepartmentOption[] = useMemo(
    () =>
      departments.map((row) => ({
        id: row.id,
        dept_no: row.dept_no ?? "",
        dept_name: row.dept_name,
        parent_id: row.parent_id,
      })),
    [departments],
  );

  // 账号筛选按"档案人员"判定：选中某员工时，筛出档案人员为该员工的账号。
  // 注意：这里用档案人员（profile_emp_no），而不是关联员工（emp_ids）——后者只是数据可见范围配置。
  const profileEmpIdByEmpNo = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach((employee) => {
      map.set(employee.emp_no, employee.id);
    });
    return map;
  }, [employees]);

  const filteredUsers = users.filter((user) => {
    if (filterRole && user.role !== filterRole) {
      return false;
    }
    if (filterEmpIds.length) {
      const profileEmpId = profileEmpIdByEmpNo.get(user.profile_emp_no);
      return profileEmpId !== undefined && filterEmpIds.includes(profileEmpId);
    }
    return true;
  });

  function toggleVisibleUserSelection(checked: boolean) {
    const visibleIds = filteredUsers.map((user) => user.id);
    setSelectedUserIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return Array.from(next);
    });
  }


  const accountTableHeaders = [
    {
      label: (
        <input
          aria-label="选择当前筛选结果"
          checked={filteredUsers.length > 0 && filteredUsers.every((user) => selectedUserIds.includes(user.id))}
          onChange={(event) => toggleVisibleUserSelection(event.target.checked)}
          type="checkbox"
        />
      ),
      sortable: false,
    },
    "ID",
    "用户名",
    "角色",
    "绑定工号",
    "绑定姓名",
    "档案部门",
    "员工范围",
    "部门范围",
    "可访问页面",
    "创建时间",
    { label: "操作", sortable: false as const },
  ];
  const accountTableRows = filteredUsers.map((user) => [
    <input
      aria-label="选择账号行"
      checked={selectedUserIds.includes(user.id)}
      onChange={(event) =>
        setSelectedUserIds((current) =>
          event.target.checked
            ? [...current, user.id]
            : current.filter((id) => id !== user.id),
        )
      }
      type="checkbox"
    />,
    user.id,
    <CompactTableText value={user.username} />,
    roleLabel(user.role),
    <CompactTableText value={user.profile_emp_no} />,
    <CompactTableText value={user.profile_name} />,
    <CompactTableText value={user.profile_department?.dept_name ?? "-"} />,
    <CompactTableText value={summarizeUserEmployees(user)} />,
    <CompactTableText value={summarizeUserDepartments(user)} />,
    <CompactTableText value={summarizePermissions(enabledPermissionKeys(user.page_permissions))} />,
    <CompactTableText value={formatDateTime(user.created_at)} />,
    <div className="toolbar">
      <button className="account-action-button" onClick={() => openEdit(user)} type="button">编辑</button>
      <button className="account-action-button account-action-button--danger" onClick={() => void deleteUser(user.id)} type="button">删除</button>
    </div>,
  ]);
  const accountTableSortRows = filteredUsers.map((user) => [
    "",
    user.id,
    user.username,
    roleLabel(user.role),
    user.profile_emp_no,
    user.profile_name,
    user.profile_department?.dept_name ?? "-",
    summarizeUserEmployees(user),
    summarizeUserDepartments(user),
    summarizePermissions(enabledPermissionKeys(user.page_permissions)),
    formatDateTime(user.created_at),
    "",
  ]);

  if (loading) {
    return <LoadingState headers={accountTableHeaders.map((header) => typeof header === "string" ? header : typeof header.label === "string" ? header.label : "")} message="正在准备账号管理页面..." variant="account-page" />;
  }

  if (loadError) {
    return <ErrorState title="账号管理加载失败" description={loadError} />;
  }

  async function submitCreate() {
    if (!createUsername.trim() || !createPassword.trim()) {
      notification.warning("用户名和密码不能为空");
      return;
    }
    if (!createProfileEmpNo.trim() || !createProfileName.trim() || !createProfileDeptId) {
      notification.warning("绑定档案人员信息不能为空");
      return;
    }

    try {
      await apiRequest("/api/admin/users", {
        body: {
          username: createUsername.trim(),
          password: createPassword,
          role: createRole,
          profile_emp_no: createProfileEmpNo.trim(),
          profile_name: createProfileName.trim(),
          profile_dept_id: Number(createProfileDeptId),
          emp_ids: createEmpIds,
          dept_ids: createDeptIds,
          page_permissions: permissionMap(createRole === "admin" ? allPermissionKeys : createPermissionKeys),
        },
        method: "POST",
      });
      setCreateUsername("");
      setCreatePassword("");
      setCreateRole("readonly");
      setCreateEmpIds([]);
      setCreateDeptIds([]);
      setCreatePermissionKeys(allPermissionKeys);
      setCreateProfileEmployeeId(null);
      setCreateProfileEmpNo("");
      setCreateProfileName("");
      setCreateProfileDeptId("");
      setCreateModalOpen(false);
      notification.success("创建成功");
      await refreshUsers();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function createManagerAccounts(password: string) {
    try {
      const result = await apiRequest<{ created_count: number; skipped_count: number }>("/api/admin/users/manager-batch", {
        body: { password },
        method: "POST",
      });
      notification.success(`成功创建 ${result.created_count} 个账号，跳过 ${result.skipped_count} 个员工`);
      setManagerPasswordOpen(false);
      setManagerPassword("");
      await refreshUsers();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "一键创建失败");
    }
  }

  function openEdit(user: AccountUser) {
    const matchedEmployee = employees.find((e) => e.emp_no === user.profile_emp_no);
    setEditProfileEmployeeId(matchedEmployee ? matchedEmployee.id : null);
    setEditingUser(user);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role);
    setEditProfileEmpNo(user.profile_emp_no);
    setEditProfileName(user.profile_name);
    setEditProfileDeptId(user.profile_dept_id ? String(user.profile_dept_id) : "");
    setEditEmpIds(user.emp_ids);
    setEditDeptIds(user.dept_ids);
    setEditPermissionKeys(
      Object.entries(user.page_permissions)
        .filter(([, allowed]) => allowed)
        .map(([key]) => key),
    );
  }

  function handleSelectProfileEmployee(ids: number[]) {
    if (ids.length === 0) {
      setEditProfileEmployeeId(null);
      setEditProfileEmpNo("");
      setEditProfileName("");
      setEditProfileDeptId("");
      return;
    }
    const id = ids[ids.length - 1];
    setEditProfileEmployeeId(id);
    const employee = employees.find((e) => e.id === id);
    if (employee) {
      setEditProfileEmpNo(employee.emp_no);
      setEditProfileName(employee.name);
      setEditProfileDeptId(employee.dept_id ? String(employee.dept_id) : "");
    }
  }

  function handleSelectCreateProfileEmployee(ids: number[]) {
    if (ids.length === 0) {
      setCreateProfileEmployeeId(null);
      setCreateProfileEmpNo("");
      setCreateProfileName("");
      setCreateProfileDeptId("");
      return;
    }
    const id = ids[ids.length - 1];
    setCreateProfileEmployeeId(id);
    const employee = employees.find((e) => e.id === id);
    if (employee) {
      setCreateProfileEmpNo(employee.emp_no);
      setCreateProfileName(employee.name);
      setCreateProfileDeptId(employee.dept_id ? String(employee.dept_id) : "");
    }
  }

  async function saveEdit() {
    if (!editingUser) {
      return;
    }
    if (!editUsername.trim() || !editProfileEmpNo.trim() || !editProfileName.trim() || !editProfileDeptId) {
      notification.warning("用户名、工号、姓名和部门信息不能为空");
      return;
    }
    try {
      await apiRequest(`/api/admin/users/${editingUser.id}`, {
        body: {
          username: editUsername.trim(),
          password: editPassword,
          role: editRole,
          profile_emp_no: editProfileEmpNo.trim(),
          profile_name: editProfileName.trim(),
          profile_dept_id: Number(editProfileDeptId),
          emp_ids: editEmpIds,
          dept_ids: editDeptIds,
          page_permissions: permissionMap(editRole === "admin" ? allPermissionKeys : editPermissionKeys),
        },
        method: "PUT",
      });
      setEditingUser(null);
      notification.success("账号已保存");
      await refreshUsers();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function resetPassword(userId: number, password: string) {
    try {
      await apiRequest(`/api/admin/users/${userId}/password`, {
        body: { password },
        method: "PUT",
      });
      notification.success("密码已重置");
      setResetTargetUser(null);
      setResetPasswordValue("");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "重置密码失败");
    }
  }

  async function deleteUser(userId: number) {
    try {
      await apiRequest(`/api/admin/users/${userId}`, { method: "DELETE" });
      notification.success("账号已删除");
      await refreshUsers();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function runBatch(action: string, payload: Record<string, unknown> = {}) {
    if (!selectedUserIds.length) {
      notification.warning("请先选择账号");
      return false;
    }
    try {
      await apiRequest("/api/admin/users/batch", {
        body: { action, user_ids: selectedUserIds, ...payload },
        method: "POST",
      });
      notification.success("批量操作已完成");
      setSelectedUserIds([]);
      await refreshUsers();
      return true;
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "批量操作失败");
      return false;
    }
  }


  return (
    <main className="account-center-page">
      <section className="account-page-stack">
        <div className="account-top-control-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
          <div className="account-panel-selector" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-outline-secondary" onClick={() => setCreateModalOpen(true)} type="button">
              创建账号
            </button>
            <button className="btn btn-outline-secondary" onClick={() => setManagerPasswordOpen(true)} type="button">
              一键创建管理人员账号
            </button>
          </div>

          <div className="active-account-set-summary-bar" style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "14px", minHeight: "36px", boxSizing: "border-box", padding: "0 14px", marginLeft: "auto", maxWidth: "100%", width: "auto", flex: "0 1 auto", background: "var(--ent-secondary-bg, #f8fafc)", border: "1px solid var(--ent-border-strong)", borderRadius: "var(--ent-radius-lg, 8px)", fontSize: "13px", color: "var(--ent-text)", boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.02)" }}>
            <div className="admin-row">
              <span style={{ color: "var(--ent-text-secondary)", fontWeight: "500" }}>账号总数：</span>
              <strong style={{ color: "var(--ent-primary)" }}>{users.length} 个</strong>
            </div>
            <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
            <div className="admin-row">
              <span style={{ color: "var(--ent-text-secondary)" }}>管理员：</span>
              <strong style={{ color: "var(--ent-primary)" }}>{users.filter((user) => user.role === "admin").length} 个</strong>
            </div>
            <div style={{ width: "1px", height: "16px", background: "var(--ent-border-strong)", opacity: 0.6 }} />
            <div className="admin-row">
              <span style={{ color: "var(--ent-text-secondary)" }}>只读账号：</span>
              <strong style={{ color: "var(--ent-primary)" }}>{users.filter((user) => user.role === "readonly").length} 个</strong>
            </div>
          </div>
        </div>



        <div className="account-card-header master-list-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "none", background: "transparent", flexWrap: "wrap", gap: "12px" }}>
          <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--ent-text)" }}>账号列表</span>
          <div className="toolbar" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button className="account-action-button" onClick={refreshUsers} type="button">刷新</button>
          </div>
        </div>

        <div className="master-filter-panel" style={{ marginBottom: "16px" }}>
          <div className="master-filter-grid">
            <label className="account-field">
              <span className="account-field-label">账号筛选</span>
              <EmployeePicker
                departments={pickerDepartments}
                employees={pickerEmployees}
                onChange={setFilterEmpIds}
                selectedIds={filterEmpIds}
                showFieldChrome={false}
              />
            </label>
            <label className="account-field">
              <span className="account-field-label">是否管理员账号</span>
              <select className="account-select" onChange={(event) => setFilterRole(event.target.value)} value={filterRole}>
                <option value="">全部</option>
                <option value="admin">是</option>
                <option value="readonly">否</option>
              </select>
            </label>
            <div className="account-filter-inline-action">
              <button className="account-action-button account-action-button--compact" onClick={() => { setFilterEmpIds([]); setFilterRole(""); }} type="button">
                清空筛选
              </button>
            </div>
          </div>
        </div>

        {selectedUserIds.length > 0 ? (
          <section aria-label="批量操作工具条" className="account-batch-toolbar">
            <div className="account-batch-toolbar__summary">
              <span className="account-batch-toolbar__icon" aria-hidden="true">✓</span>
              <div>
                <strong>已选择 {selectedUserIds.length} 个账号</strong>
                <span>可对选中账号执行批量操作</span>
              </div>
            </div>

            <div className="account-batch-toolbar__actions">
              <div className="account-batch-toolbar__group">
                <span className="account-batch-toolbar__group-label">修改信息</span>
                <button className="account-action-button" onClick={() => setBatchRoleOpen(true)} type="button">修改角色</button>
                <button className="account-action-button" onClick={() => setBatchEmployeeOpen(true)} type="button">关联员工</button>
                <button className="account-action-button" onClick={() => setBatchDepartmentOpen(true)} type="button">关联部门</button>
              </div>
              <div className="account-batch-toolbar__group">
                <span className="account-batch-toolbar__group-label">权限与安全</span>
                <button className="account-action-button" onClick={() => setBatchPermissionOpen(true)} type="button">页面权限</button>
                <button className="account-action-button account-action-button--warning" onClick={() => setBatchPasswordOpen(true)} type="button">重置密码</button>
              </div>
              <div className="account-batch-toolbar__group account-batch-toolbar__group--danger">
                <span className="account-batch-toolbar__group-label">危险操作</span>
                <button className="account-action-button account-action-button--danger" onClick={() => void runBatch("delete")} type="button">删除账号</button>
              </div>
            </div>

            <button className="account-batch-toolbar__clear" onClick={() => setSelectedUserIds([])} type="button">
              清除选择
            </button>
          </section>
        ) : null}

        <QueryResultPanel>
          <QueryTable
            emptyText="暂无账号数据"
            headers={accountTableHeaders}
            panelClassName="account-table-panel"
            rows={accountTableRows}
            sortRows={accountTableSortRows}
          />
        </QueryResultPanel>
      </section>

      {createModalOpen ? (
        <div className="master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setCreateModalOpen(false); }} style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 1500,
          background: "rgba(15, 23, 42, 0.48)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          boxSizing: "border-box",
        }}>
          <div className="master-modal-container" style={{
            width: "100%",
            maxWidth: "960px",
            maxHeight: "min(90vh, 760px)",
            background: "#ffffff",
            borderRadius: "14px",
            boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* 顶部固定标题栏 */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              borderBottom: "1px solid #e2e8f0",
              background: "#ffffff",
              flexShrink: 0,
            }}>
              <div className="admin-row-gap12">
                <span style={{ fontSize: "16px", fontWeight: "600", color: "#0f172a" }}>创建账号</span>
                <span className="page-tag" style={{ margin: 0 }}>系统管理</span>
              </div>
              <button
                className="master-modal-close"
                onClick={() => setCreateModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "22px",
                  cursor: "pointer",
                  color: "#94a3b8",
                  padding: "4px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                type="button"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            
            {/* 中间双栏主体 */}
            <div
              className="master-modal-body custom-scrollbar"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "grid",
                gridTemplateColumns: "minmax(330px, 390px) 1fr",
                gap: "20px",
                alignItems: "start",
              }}
            >
              {/* 左栏：基础信息与数据可见范围 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#334155", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                    基础信息
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">绑定档案人员 (自动提取工号/姓名/部门)</span>
                    <EmployeePicker
                      departments={pickerDepartments}
                      employees={pickerEmployees}
                      onChange={handleSelectCreateProfileEmployee}
                      selectedIds={createProfileEmployeeId ? [createProfileEmployeeId] : []}
                      showFieldChrome={true}
                      singleSelect={true}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label className="account-field" style={{ margin: 0 }}>
                      <span className="account-field-label">用户名</span>
                      <input className="account-input" onChange={(event) => setCreateUsername(event.target.value)} value={createUsername} placeholder="例如: admin01" />
                    </label>
                    <label className="account-field" style={{ margin: 0 }}>
                      <span className="account-field-label">初始密码</span>
                      <input className="account-input" type="password" onChange={(event) => setCreatePassword(event.target.value)} value={createPassword} placeholder="请输入初始密码" />
                    </label>
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">账号角色</span>
                    <select className="account-select" onChange={(event) => setCreateRole(event.target.value as "readonly" | "admin")} value={createRole}>
                      <option value="readonly">只读权限</option>
                      <option value="admin">系统管理员</option>
                    </select>
                  </label>
                </div>

                <div style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#334155", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                    数据可见范围
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">关联员工 (限定可见个人数据)</span>
                    <EmployeePicker
                      departments={pickerDepartments}
                      employees={pickerEmployees}
                      onChange={setCreateEmpIds}
                      selectedIds={createEmpIds}
                      showFieldChrome={false}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">关联部门 (限定可见部门数据)</span>
                    <DepartmentMultiPicker
                      departments={departments}
                      onChange={setCreateDeptIds}
                      selectedIds={createDeptIds}
                      showFieldChrome={false}
                    />
                  </label>
                </div>
              </div>

              {/* 右栏：功能导航权限 */}
              <div style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
              }}>
                <NavigationPermissionSection
                  isAdmin={createRole === "admin"}
                  onChange={setCreatePermissionKeys}
                  selectedKeys={createPermissionKeys}
                />
              </div>
            </div>

            {/* 底部固定操作栏 */}
            <div style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              flexShrink: 0,
            }}>
              <button
                className="account-action-button"
                onClick={() => setCreateModalOpen(false)}
                type="button"
                style={{ borderRadius: "8px", fontSize: "14px", padding: "7px 18px" }}
              >
                取消
              </button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={submitCreate}
                type="button"
                style={{ padding: "7px 24px", borderRadius: "8px", fontWeight: "500", fontSize: "14px", boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)" }}
              >
                创建账号
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingUser ? (
        <div className="master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditingUser(null); }} style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 1500,
          background: "rgba(15, 23, 42, 0.48)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          boxSizing: "border-box",
        }}>
          <div className="master-modal-container" style={{
            width: "100%",
            maxWidth: "960px",
            maxHeight: "min(90vh, 760px)",
            background: "#ffffff",
            borderRadius: "14px",
            boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* 顶部固定标题栏 */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              borderBottom: "1px solid #e2e8f0",
              background: "#ffffff",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "16px", fontWeight: "600", color: "#0f172a" }}>编辑账号</span>
                <span className="page-tag" style={{ margin: 0 }}>系统管理</span>
                {editingUser && (
                  <span style={{
                    fontSize: "12px",
                    color: "#2563eb",
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontWeight: "500",
                  }}>
                    {editingUser.username}
                  </span>
                )}
              </div>
              <button
                className="master-modal-close"
                onClick={() => setEditingUser(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "22px",
                  cursor: "pointer",
                  color: "#94a3b8",
                  padding: "4px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                type="button"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            {/* 中间双栏主体 */}
            <div
              className="master-modal-body custom-scrollbar"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "grid",
                gridTemplateColumns: "minmax(330px, 390px) 1fr",
                gap: "20px",
                alignItems: "start",
              }}
            >
              {/* 左栏：基础信息与数据可见范围 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* 基础信息 */}
                <div style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#334155", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                    基础信息
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">绑定档案人员 (自动提取工号/姓名/部门)</span>
                    <EmployeePicker
                      departments={pickerDepartments}
                      employees={pickerEmployees}
                      onChange={handleSelectProfileEmployee}
                      selectedIds={editProfileEmployeeId ? [editProfileEmployeeId] : []}
                      showFieldChrome={true}
                      singleSelect={true}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label className="account-field" style={{ margin: 0 }}>
                      <span className="account-field-label">用户名</span>
                      <input className="account-input" onChange={(event) => setEditUsername(event.target.value)} value={editUsername} />
                    </label>
                    <label className="account-field" style={{ margin: 0 }}>
                      <span className="account-field-label">密码 (留空则不修改)</span>
                      <input className="account-input" type="password" onChange={(event) => setEditPassword(event.target.value)} value={editPassword} placeholder="留空则不修改" />
                    </label>
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">角色</span>
                    <select className="account-select" onChange={(event) => setEditRole(event.target.value as "readonly" | "admin")} value={editRole}>
                      <option value="readonly">只读权限</option>
                      <option value="admin">系统管理员</option>
                    </select>
                  </label>
                </div>

                {/* 数据可见范围 */}
                <div style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#334155", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                    数据可见范围
                  </div>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">关联员工 (限定可见个人数据)</span>
                    <EmployeePicker
                      departments={pickerDepartments}
                      employees={pickerEmployees}
                      onChange={setEditEmpIds}
                      selectedIds={editEmpIds}
                      showFieldChrome={false}
                    />
                  </label>
                  <label className="account-field" style={{ margin: 0 }}>
                    <span className="account-field-label">关联部门 (限定可见部门数据)</span>
                    <DepartmentMultiPicker
                      departments={departments}
                      onChange={setEditDeptIds}
                      selectedIds={editDeptIds}
                      showFieldChrome={false}
                    />
                  </label>
                </div>
              </div>

              {/* 右栏：功能导航权限 */}
              <div style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
              }}>
                <NavigationPermissionSection
                  isAdmin={editRole === "admin"}
                  onChange={setEditPermissionKeys}
                  selectedKeys={editPermissionKeys}
                />
              </div>
            </div>

            {/* 底部固定操作栏 */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              flexShrink: 0,
            }}>
              <button
                className="account-action-button account-action-button--warning"
                onClick={() => {
                  setResetTargetUser(editingUser);
                  setResetPasswordValue("");
                }}
                type="button"
                style={{ borderRadius: "8px", fontSize: "13px" }}
              >
                重置密码
              </button>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="account-action-button"
                  onClick={() => setEditingUser(null)}
                  type="button"
                  style={{ borderRadius: "8px", fontSize: "14px", padding: "7px 18px" }}
                >
                  取消
                </button>
                <button
                  className="account-action-button account-action-button--primary"
                  onClick={saveEdit}
                  type="button"
                  style={{ padding: "7px 24px", borderRadius: "8px", fontWeight: "500", fontSize: "14px", boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)" }}
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {batchPermissionOpen ? (
        <div className="master-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBatchPermissionOpen(false); }} style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 1500,
          background: "rgba(15, 23, 42, 0.48)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          boxSizing: "border-box",
        }}>
          <div className="master-modal-container" style={{
            width: "100%",
            maxWidth: "680px",
            maxHeight: "min(88vh, 720px)",
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              borderBottom: "1px solid #e2e8f0",
              background: "#ffffff",
              flexShrink: 0,
            }}>
              <div className="admin-row-gap12">
                <span style={{ fontSize: "16px", fontWeight: "600", color: "#0f172a" }}>批量修改页面权限</span>
                <span className="page-tag" style={{ margin: 0 }}>系统管理</span>
              </div>
              <button
                className="master-modal-close"
                onClick={() => setBatchPermissionOpen(false)}
                style={{ border: "none", background: "transparent", fontSize: "22px", cursor: "pointer", color: "#94a3b8", padding: "4px", lineHeight: 1 }}
                type="button"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            
            <div className="master-modal-body custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              <NavigationPermissionSection
                onChange={setBatchPermissionKeys}
                selectedKeys={batchPermissionKeys}
              />
            </div>

            <div style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              flexShrink: 0,
            }}>
              <button
                className="account-action-button"
                onClick={() => setBatchPermissionOpen(false)}
                type="button"
                style={{ borderRadius: "8px", fontSize: "14px", padding: "7px 18px" }}
              >
                取消
              </button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={async () => {
                  if (await runBatch("update_permissions", { page_permissions: permissionMap(batchPermissionKeys) })) {
                    setBatchPermissionOpen(false);
                  }
                }}
                type="button"
                style={{ padding: "7px 24px", borderRadius: "8px", fontWeight: "500", fontSize: "14px", boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)" }}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}



      {batchRoleOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal">
            <div className="master-modal-header">
              <h2>批量修改角色</h2>
              <button className="master-modal-close" onClick={() => setBatchRoleOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <label className="account-field">
                <span className="account-field-label">选择角色</span>
                <select className="account-select" onChange={(event) => setBatchRole(event.target.value as "" | "admin" | "readonly")} value={batchRole}>
                  <option value="">请选择角色</option>
                  <option value="readonly">只读</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchRoleOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={async () => {
                  if (await runBatch("update_role", { role: batchRole })) {
                    setBatchRoleOpen(false);
                  }
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchEmployeeOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal account-edit-modal">
            <div className="master-modal-header">
              <h2>批量修改关联员工</h2>
              <button className="master-modal-close" onClick={() => setBatchEmployeeOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body" style={{ overflow: "visible" }}>
              <p className="master-form-text">选择后将直接覆盖所选账号的关联员工；留空并确认表示清空关联员工。</p>
              <EmployeePicker
                departments={pickerDepartments}
                employees={pickerEmployees}
                onChange={setBatchEmployeeIds}
                selectedIds={batchEmployeeIds}
                showFieldChrome={false}
              />
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchEmployeeOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={async () => {
                  if (await runBatch("update_employees", { emp_ids: batchEmployeeIds })) {
                    setBatchEmployeeOpen(false);
                  }
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchDepartmentOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal account-department-modal">
            <div className="master-modal-header">
              <h2>批量修改关联部门</h2>
              <button className="master-modal-close" onClick={() => setBatchDepartmentOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body" style={{ overflow: "visible" }}>
              <p className="master-form-text">选择后将直接覆盖所选账号的关联部门；留空并确认表示清空关联部门。</p>
              <DepartmentMultiPicker
                departments={departments}
                selectedIds={batchDepartmentIds}
                onChange={setBatchDepartmentIds}
                showFieldChrome={false}
              />
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchDepartmentOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={async () => {
                  if (await runBatch("update_departments", { dept_ids: batchDepartmentIds })) {
                    setBatchDepartmentOpen(false);
                  }
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchPasswordOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal">
            <div className="master-modal-header">
              <h2>批量重置密码</h2>
              <button className="master-modal-close" onClick={() => setBatchPasswordOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <p className="master-form-text">所选账号将被重置为同一个新密码，请告知用户尽快登录修改。</p>
              <label className="account-field">
                <span className="account-field-label">新密码</span>
                <input className="account-input" type="password" onChange={(event) => setBatchPassword(event.target.value)} value={batchPassword} placeholder="请输入新密码" />
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchPasswordOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                disabled={!batchPassword}
                onClick={async () => {
                  if (await runBatch("reset_password", { password: batchPassword })) {
                    setBatchPasswordOpen(false);
                    setBatchPassword("");
                  }
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {managerPasswordOpen ? (
        <div className="master-modal-backdrop">
          <div className="master-modal">
            <div className="master-modal-header">
              <h2>一键创建管理人员账号</h2>
              <button className="master-modal-close" onClick={() => setManagerPasswordOpen(false)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <p className="master-form-text">将为所有尚未建号的管理人员创建账号，统一使用下方初始密码，请告知用户尽快登录修改。</p>
              <label className="account-field">
                <span className="account-field-label">初始密码</span>
                <input className="account-input" type="password" onChange={(event) => setManagerPassword(event.target.value)} value={managerPassword} placeholder="请输入初始密码" />
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setManagerPasswordOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                disabled={!managerPassword}
                onClick={() => void createManagerAccounts(managerPassword)}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetTargetUser ? (
        <div className="master-modal-backdrop">
          <div className="master-modal">
            <div className="master-modal-header">
              <h2>重置密码</h2>
              <button className="master-modal-close" onClick={() => { setResetTargetUser(null); setResetPasswordValue(""); }} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <p className="master-form-text">为账号 {resetTargetUser.username} 设置新密码。</p>
              <label className="account-field">
                <span className="account-field-label">新密码</span>
                <input className="account-input" type="password" onChange={(event) => setResetPasswordValue(event.target.value)} value={resetPasswordValue} placeholder="请输入新密码" />
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => { setResetTargetUser(null); setResetPasswordValue(""); }} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                disabled={!resetPasswordValue}
                onClick={() => void resetPassword(resetTargetUser.id, resetPasswordValue)}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function NavigationPermissionSection({
  selectedKeys,
  onChange,
  isAdmin = false,
}: {
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  isAdmin?: boolean;
}) {
  const activeKeys = isAdmin ? allPermissionKeys : selectedKeys;
  const isAllSelected = allPermissionKeys.every((key) => activeKeys.includes(key));
  const isNoneSelected = activeKeys.length === 0;

  const handleSelectAll = () => {
    onChange([...allPermissionKeys]);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const toggleGroup = (groupKey: string) => {
    const groupItemKeys: string[] = permissionCatalog
      .filter((item) => item.group === groupKey)
      .map((item) => item.key);
    const allGroupSelected = groupItemKeys.every((k) => activeKeys.includes(k));
    if (allGroupSelected) {
      onChange(activeKeys.filter((k) => !groupItemKeys.includes(k)));
    } else {
      onChange(Array.from(new Set([...activeKeys, ...groupItemKeys])));
    }
  };

  const toggleSingle = (key: string) => {
    if (activeKeys.includes(key)) {
      onChange(activeKeys.filter((k) => k !== key));
    } else {
      onChange([...activeKeys, key]);
    }
  };

  return (
    <div className="account-permission-section" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="account-field-label" style={{ margin: 0, fontWeight: "600", fontSize: "13px", color: "var(--ent-text, #1e293b)" }}>
            功能导航权限
          </span>
          <span style={{
            fontSize: "12px",
            padding: "2px 8px",
            borderRadius: "10px",
            background: isAdmin ? "#dbeafe" : activeKeys.length > 0 ? "#eff6ff" : "#f1f5f9",
            color: isAdmin ? "#1d4ed8" : activeKeys.length > 0 ? "#2563eb" : "#64748b",
            fontWeight: "500",
          }}>
            {isAdmin ? "全部权限 (管理员)" : `已选 ${activeKeys.length} / ${allPermissionKeys.length} 项`}
          </span>
        </div>

        {!isAdmin && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isAllSelected}
              style={{
                background: "transparent",
                border: "none",
                color: isAllSelected ? "#94a3b8" : "#2563eb",
                fontSize: "12px",
                cursor: isAllSelected ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontWeight: "500",
              }}
            >
              全部勾选
            </button>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isNoneSelected}
              style={{
                background: "transparent",
                border: "none",
                color: isNoneSelected ? "#94a3b8" : "#64748b",
                fontSize: "12px",
                cursor: isNoneSelected ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontWeight: "500",
              }}
            >
              全部清空
            </button>
          </div>
        )}
      </div>

      {isAdmin ? (
        <div style={{
          padding: "10px 14px",
          borderRadius: "8px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          color: "#0369a1",
          fontSize: "13px",
          lineHeight: "1.5",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          <span style={{ fontSize: "16px" }}>ℹ️</span>
          <span>系统管理员账号默认拥有系统所有页面的访问和管理权限，无需单独配置。</span>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {PERMISSION_GROUPS.map((group) => {
          const groupItems = permissionCatalog.filter((item) => item.group === group.key);
          const groupItemKeys: string[] = groupItems.map((item) => item.key);
          const selectedInGroup = groupItemKeys.filter((k) => activeKeys.includes(k)).length;
          const isGroupAllSelected = selectedInGroup === groupItems.length;

          return (
            <div
              key={group.key}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                background: "#ffffff",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}>
                    {group.title}
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    ({selectedInGroup}/{groupItems.length})
                  </span>
                </div>

                {!isAdmin && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#3b82f6",
                      fontSize: "11px",
                      cursor: "pointer",
                      padding: "0 4px",
                      fontWeight: "500",
                    }}
                  >
                    {isGroupAllSelected ? "取消全选" : "本组全选"}
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                  gap: "6px",
                }}
              >
                {groupItems.map((item) => {
                  const isChecked = activeKeys.includes(item.key);
                  return (
                    <label
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 10px",
                        borderRadius: "6px",
                        background: isChecked ? "#eff6ff" : "#f8fafc",
                        border: `1px solid ${isChecked ? "#bfdbfe" : "#e2e8f0"}`,
                        cursor: isAdmin ? "default" : "pointer",
                        userSelect: "none",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isAdmin}
                        onChange={() => toggleSingle(item.key)}
                        style={{
                          width: "14px",
                          height: "14px",
                          accentColor: "#2563eb",
                          cursor: isAdmin ? "default" : "pointer",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "12.5px",
                          color: isChecked ? "#1e40af" : "#475569",
                          fontWeight: isChecked ? "500" : "400",
                          lineHeight: "1.3",
                        }}
                      >
                        {item.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactTableText({ value }: { value: string }) {
  return (
    <span className="account-table-text-ellipsis" title={value}>
      {value}
    </span>
  );
}

function permissionMap(keys: string[]): Record<string, boolean> {
  return Object.fromEntries(allPermissionKeys.map((key) => [key, keys.includes(key)]));
}

function summarizePermissions(keys: string[]): string {
  const labels = permissionCatalog.filter((row) => keys.includes(row.key)).map((row) => row.label);
  return labels.length ? labels.join("、") : "未选择页面权限";
}


function summarizeUserEmployees(user: AccountUser): string {
  if (user.role === "admin") {
    return "全部人员";
  }
  return user.employees.length ? user.employees.map((row) => `${row.emp_no}-${row.name}`).join("，") : "-";
}

function summarizeUserDepartments(user: AccountUser): string {
  if (user.role === "admin") {
    return "全部部门";
  }
  return user.departments.length ? user.departments.map((row) => row.dept_name).join("，") : "-";
}

function enabledPermissionKeys(permissions: Record<string, boolean>): string[] {
  return Object.entries(permissions)
    .filter(([, allowed]) => allowed)
    .map(([key]) => key);
}

function roleLabel(role: "admin" | "readonly"): string {
  return role === "admin" ? "系统管理员" : "只读";
}

function formatDateTime(value: string | null): string {
  return value ? value.replace("T", " ").slice(0, 19) : "-";
}

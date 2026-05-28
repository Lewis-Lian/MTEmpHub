import { useEffect, useMemo, useState } from "react";

import { fetchAdminDepartments, fetchAdminEmployees } from "../../api/admin";
import { apiRequest } from "../../api/client";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import DepartmentPicker from "../../components/query/DepartmentPicker";
import EmployeePicker from "../../components/query/EmployeePicker";
import type { AdminDepartment, AdminEmployee } from "../../types/admin";
import type { DepartmentOption, QueryEmployee } from "../../types/query";

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
  { key: "manager_query", label: "管理人员考勤数据查询", group: "管理人员" },
  { key: "manager_overtime_query", label: "查询加班", group: "管理人员" },
  { key: "manager_annual_leave_query", label: "查询年休", group: "管理人员" },
  { key: "employee_dashboard", label: "员工考勤数据查询", group: "员工" },
  { key: "abnormal_query", label: "员工异常查询", group: "员工" },
  { key: "punch_records", label: "员工打卡数据查询", group: "员工" },
  { key: "department_hours_query", label: "员工部门工时查询", group: "员工" },
  { key: "summary_download", label: "汇总下载", group: "员工" },
] as const;

const allPermissionKeys = permissionCatalog.map((item) => item.key);

export default function AccountsPage() {
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [resultError, setResultError] = useState("");

  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"readonly" | "admin">("readonly");
  const [createEmpIds, setCreateEmpIds] = useState<number[]>([]);
  const [createDeptIds, setCreateDeptIds] = useState<number[]>([]);
  const [createPermissionKeys, setCreatePermissionKeys] = useState<string[]>(allPermissionKeys);

  const [filterEmpIds, setFilterEmpIds] = useState<number[]>([]);
  const [filterRole, setFilterRole] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const [editingUser, setEditingUser] = useState<AccountUser | null>(null);
  const [editRole, setEditRole] = useState<"readonly" | "admin">("readonly");
  const [editProfileEmpNo, setEditProfileEmpNo] = useState("");
  const [editProfileName, setEditProfileName] = useState("");
  const [editProfileDeptId, setEditProfileDeptId] = useState("");
  const [editEmpIds, setEditEmpIds] = useState<number[]>([]);
  const [editDeptIds, setEditDeptIds] = useState<number[]>([]);
  const [editPermissionKeys, setEditPermissionKeys] = useState<string[]>(allPermissionKeys);

  const [permissionContext, setPermissionContext] = useState<null | "create" | "edit" | "batch">(null);
  const [permissionKeyword, setPermissionKeyword] = useState("");
  const [permissionGroup, setPermissionGroup] = useState("");

  const [departmentContext, setDepartmentContext] = useState<null | "create" | "edit" | "batch">(null);
  const [departmentKeyword, setDepartmentKeyword] = useState("");
  const [draftDepartmentIds, setDraftDepartmentIds] = useState<number[]>([]);

  const [batchRoleOpen, setBatchRoleOpen] = useState(false);
  const [batchRole, setBatchRole] = useState<"" | "admin" | "readonly">("");
  const [batchEmployeeOpen, setBatchEmployeeOpen] = useState(false);
  const [batchEmployeeIds, setBatchEmployeeIds] = useState<number[]>([]);
  const [batchDepartmentOpen, setBatchDepartmentOpen] = useState(false);
  const [batchDepartmentIds, setBatchDepartmentIds] = useState<number[]>([]);
  const [batchPermissionKeys, setBatchPermissionKeys] = useState<string[]>(allPermissionKeys);

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    setLoading(true);
    setLoadError("");
    try {
      const [userRows, employeeRows, departmentRows] = await Promise.all([
        apiRequest<AccountUser[]>("/admin/users"),
        fetchAdminEmployees(),
        fetchAdminDepartments(),
      ]);
      setUsers(Array.isArray(userRows) ? userRows : []);
      setEmployees(employeeRows);
      setDepartments(departmentRows);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "账号管理加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshUsers() {
    const rows = await apiRequest<AccountUser[]>("/admin/users");
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

  const filteredUsers = users.filter((user) => {
    if (filterRole && user.role !== filterRole) {
      return false;
    }
    if (filterEmpIds.length) {
      return filterEmpIds.some((id) => user.emp_ids.includes(id));
    }
    return true;
  });

  const filteredPermissionRows = permissionCatalog.filter((row) => {
    if (permissionGroup && row.group !== permissionGroup) {
      return false;
    }
    if (permissionKeyword.trim()) {
      return `${row.label}${row.group}`.includes(permissionKeyword.trim());
    }
    return true;
  });

  const filteredDepartmentRows = departments.filter((row) => {
    if (!departmentKeyword.trim()) {
      return true;
    }
    return `${row.dept_no ?? ""} ${row.dept_name}`.toLowerCase().includes(departmentKeyword.trim().toLowerCase());
  });

  if (loading) {
    return <LoadingState message="正在准备账号管理页面..." />;
  }

  if (loadError) {
    return <ErrorState title="账号管理加载失败" description={loadError} />;
  }

  async function submitCreate() {
    setResultMessage("");
    setResultError("");
    if (!createUsername.trim() || !createPassword.trim()) {
      setResultError("用户名和密码不能为空");
      return;
    }

    try {
      await apiRequest("/admin/users", {
        body: {
          username: createUsername.trim(),
          password: createPassword,
          role: createRole,
          emp_ids: createEmpIds,
          dept_ids: createDeptIds,
          page_permissions: permissionMap(createPermissionKeys),
        },
        method: "POST",
      });
      setCreateUsername("");
      setCreatePassword("");
      setCreateRole("readonly");
      setCreateEmpIds([]);
      setCreateDeptIds([]);
      setCreatePermissionKeys(allPermissionKeys);
      setResultMessage("创建成功");
      await refreshUsers();
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function createManagerAccounts() {
    setResultMessage("");
    setResultError("");
    try {
      const result = await apiRequest<{ created_count: number; skipped_count: number }>("/admin/users/manager-batch", {
        method: "POST",
      });
      setResultMessage(`成功创建 ${result.created_count} 个账号，跳过 ${result.skipped_count} 个员工`);
      await refreshUsers();
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "一键创建失败");
    }
  }

  function openEdit(user: AccountUser) {
    setEditingUser(user);
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

  async function saveEdit() {
    if (!editingUser) {
      return;
    }
    setResultMessage("");
    setResultError("");
    if (!editProfileEmpNo.trim() || !editProfileName.trim() || !editProfileDeptId) {
      setResultError("工号、姓名和部门信息不能为空");
      return;
    }
    try {
      await apiRequest(`/admin/users/${editingUser.id}`, {
        body: {
          role: editRole,
          profile_emp_no: editProfileEmpNo.trim(),
          profile_name: editProfileName.trim(),
          profile_dept_id: Number(editProfileDeptId),
          emp_ids: editEmpIds,
          dept_ids: editDeptIds,
          page_permissions: permissionMap(editPermissionKeys),
        },
        method: "PUT",
      });
      setEditingUser(null);
      setResultMessage("账号已保存");
      await refreshUsers();
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function resetPassword(userId: number) {
    setResultMessage("");
    setResultError("");
    try {
      await apiRequest(`/admin/users/${userId}/password`, {
        body: { password: "mt@123" },
        method: "PUT",
      });
      setResultMessage("密码已重置为 mt@123");
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "重置密码失败");
    }
  }

  async function deleteUser(userId: number) {
    setResultMessage("");
    setResultError("");
    try {
      await apiRequest(`/admin/users/${userId}`, { method: "DELETE" });
      setResultMessage("账号已删除");
      await refreshUsers();
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function runBatch(action: string, payload: Record<string, unknown> = {}) {
    setResultMessage("");
    setResultError("");
    if (!selectedUserIds.length) {
      setResultError("请先选择账号");
      return false;
    }
    try {
      await apiRequest("/admin/users/batch", {
        body: { action, user_ids: selectedUserIds, ...payload },
        method: "POST",
      });
      setResultMessage("批量操作已完成");
      await refreshUsers();
      return true;
    } catch (error) {
      setResultError(error instanceof Error ? error.message : "批量操作失败");
      return false;
    }
  }

  function currentPermissionKeys() {
    if (permissionContext === "create") {
      return createPermissionKeys;
    }
    if (permissionContext === "edit") {
      return editPermissionKeys;
    }
    return batchPermissionKeys;
  }

  function setCurrentPermissionKeys(nextKeys: string[]) {
    if (permissionContext === "create") {
      setCreatePermissionKeys(nextKeys);
      return;
    }
    if (permissionContext === "edit") {
      setEditPermissionKeys(nextKeys);
      return;
    }
    setBatchPermissionKeys(nextKeys);
  }

  function commitDepartmentSelection() {
    if (departmentContext === "create") {
      setCreateDeptIds(draftDepartmentIds);
    } else if (departmentContext === "edit") {
      setEditDeptIds(draftDepartmentIds);
    } else {
      setBatchDepartmentIds(draftDepartmentIds);
    }
    setDepartmentContext(null);
    setDepartmentKeyword("");
  }

  return (
    <main className="account-center-page">
      <section className="legacy-page-section">
        <header className="legacy-page-header">
          <div className="legacy-page-heading">
            <p className="legacy-page-kicker">后台管理</p>
            <h2 className="legacy-page-title">账号管理</h2>
            <p className="legacy-page-description">维护登录账号、角色权限及员工、部门的数据访问范围。</p>
          </div>
        </header>

        <div className="account-workflow">
          <aside className="account-workflow-side sticky-side">
            <section className="account-card">
              <div className="account-card-header">
                <span>创建账号表单</span>
                <span className="page-tag">Account Setup</span>
              </div>
              <div className="account-card-body">
                <div className="account-create-form">
                  <label className="account-field">
                    <span className="account-field-label">用户名</span>
                    <input className="account-input" onChange={(event) => setCreateUsername(event.target.value)} value={createUsername} />
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">密码</span>
                    <input className="account-input" onChange={(event) => setCreatePassword(event.target.value)} type="password" value={createPassword} />
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">角色</span>
                    <select className="account-select" onChange={(event) => setCreateRole(event.target.value as "readonly" | "admin")} value={createRole}>
                      <option value="readonly">只读</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">关联员工（可搜索、多选）</span>
                    <EmployeePicker
                      departments={pickerDepartments}
                      employees={pickerEmployees}
                      onChange={setCreateEmpIds}
                      selectedIds={createEmpIds}
                      showFieldChrome={false}
                    />
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">关联部门（可搜索、多选）</span>
                    <PickerSummaryField
                      buttonLabel="选择"
                      onClick={() => {
                        setDraftDepartmentIds(createDeptIds);
                        setDepartmentContext("create");
                      }}
                      value={summarizeDepartments(createDeptIds, departments)}
                    />
                  </label>
                  <label className="account-field">
                    <span className="account-field-label">账号页面权限</span>
                    <PickerSummaryField
                      buttonLabel="选择"
                      onClick={() => setPermissionContext("create")}
                      value={summarizePermissions(createPermissionKeys)}
                    />
                  </label>
                  <div className="toolbar">
                    <button className="account-action-button account-action-button--primary" onClick={submitCreate} type="button">
                      创建账号
                    </button>
                    <button className="account-action-button" onClick={createManagerAccounts} type="button">
                      一键创建管理人员账号
                    </button>
                  </div>
                </div>
                {resultMessage ? <div className="account-result-message">{resultMessage}</div> : null}
                {resultError ? <div className="legacy-inline-error">{resultError}</div> : null}
              </div>
            </section>
          </aside>

          <section className="account-card account-workflow-main table-wrap-tight">
            <div className="account-card-header">
              <span>账号列表</span>
              <button className="account-action-button" onClick={refreshUsers} type="button">刷新</button>
            </div>
            <div className="account-card-body">
              <div className="account-grid-two">
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
              </div>
              <div className="toolbar account-list-toolbar">
                <button className="account-action-button account-action-button--primary" type="button">查询</button>
                <button
                  className="account-action-button"
                  onClick={() => {
                    setFilterEmpIds([]);
                    setFilterRole("");
                  }}
                  type="button"
                >
                  重置
                </button>
              </div>

              <div className="toolbar account-list-toolbar">
                <span className="master-selected-count">已选 {selectedUserIds.length} 个账号</span>
                <button className="account-action-button" onClick={() => setBatchRoleOpen(true)} type="button">批量修改角色</button>
                <button className="account-action-button" onClick={() => setBatchEmployeeOpen(true)} type="button">批量修改关联员工</button>
                <button className="account-action-button" onClick={() => { setDraftDepartmentIds(batchDepartmentIds); setBatchDepartmentOpen(true); }} type="button">批量修改关联部门</button>
                <button className="account-action-button" onClick={() => setPermissionContext("batch")} type="button">批量修改页面权限</button>
                <button className="account-action-button account-action-button--warning" onClick={() => void runBatch("reset_password")} type="button">批量重置密码</button>
                <button className="account-action-button account-action-button--danger" onClick={() => void runBatch("delete")} type="button">批量删除账号</button>
              </div>

              <div className="legacy-table-panel">
                <div className="legacy-table-wrap">
                  <table className="legacy-table">
                    <thead>
                      <tr>
                        <th className="legacy-table-head-cell">
                          <input
                            checked={filteredUsers.length > 0 && filteredUsers.every((user) => selectedUserIds.includes(user.id))}
                            onChange={(event) =>
                              setSelectedUserIds(event.target.checked ? filteredUsers.map((user) => user.id) : [])
                            }
                            type="checkbox"
                          />
                        </th>
                        <th className="legacy-table-head-cell">ID</th>
                        <th className="legacy-table-head-cell">用户名</th>
                        <th className="legacy-table-head-cell">角色</th>
                        <th className="legacy-table-head-cell">绑定工号</th>
                        <th className="legacy-table-head-cell">绑定姓名</th>
                        <th className="legacy-table-head-cell">档案部门</th>
                        <th className="legacy-table-head-cell">员工范围</th>
                        <th className="legacy-table-head-cell">部门范围</th>
                        <th className="legacy-table-head-cell">可访问页面</th>
                        <th className="legacy-table-head-cell">创建时间</th>
                        <th className="legacy-table-head-cell">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr key={user.id}>
                          <td className="legacy-table-body-cell">
                            <input
                              checked={selectedUserIds.includes(user.id)}
                              onChange={() =>
                                setSelectedUserIds((current) =>
                                  current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id],
                                )
                              }
                              type="checkbox"
                            />
                          </td>
                          <td className="legacy-table-body-cell">{user.id}</td>
                          <td className="legacy-table-body-cell">{user.username}</td>
                          <td className="legacy-table-body-cell">{roleLabel(user.role)}</td>
                          <td className="legacy-table-body-cell">{user.profile_emp_no}</td>
                          <td className="legacy-table-body-cell">{user.profile_name}</td>
                          <td className="legacy-table-body-cell">{user.profile_department?.dept_name ?? "-"}</td>
                          <td className="legacy-table-body-cell">{summarizeUserEmployees(user)}</td>
                          <td className="legacy-table-body-cell">{summarizeUserDepartments(user)}</td>
                          <td className="legacy-table-body-cell">{summarizePermissions(enabledPermissionKeys(user.page_permissions))}</td>
                          <td className="legacy-table-body-cell">{formatDateTime(user.created_at)}</td>
                          <td className="legacy-table-body-cell">
                            <div className="toolbar">
                              <button className="account-action-button" onClick={() => openEdit(user)} type="button">编辑</button>
                              <button className="account-action-button account-action-button--warning" onClick={() => void resetPassword(user.id)} type="button">重置密码</button>
                              <button className="account-action-button account-action-button--danger" onClick={() => void deleteUser(user.id)} type="button">删除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      {editingUser ? (
        <div className="master-modal-backdrop">
          <div className="master-modal account-edit-modal">
            <div className="master-modal-header">
              <h2>编辑账号</h2>
              <button className="master-modal-close" onClick={() => setEditingUser(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <div className="account-grid-two">
                <label className="account-field">
                  <span className="account-field-label">工号</span>
                  <input className="account-input" onChange={(event) => setEditProfileEmpNo(event.target.value)} value={editProfileEmpNo} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">姓名</span>
                  <input className="account-input" onChange={(event) => setEditProfileName(event.target.value)} value={editProfileName} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">部门信息</span>
                  <DepartmentPicker
                    departments={departments}
                    onChange={setEditProfileDeptId}
                    pickerTitle="选择部门信息"
                    placeholder="选择部门信息"
                    quickEmptyValueLabel="无匹配部门"
                    rootOptionLabel="请选择部门"
                    searchPlaceholder="搜索部门名称/编号"
                    selectedEmptyLabel="未选择"
                    title="选择部门"
                    value={editProfileDeptId}
                  />
                </label>
                <label className="account-field">
                  <span className="account-field-label">用户名</span>
                  <input className="account-input" readOnly value={editingUser.username} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">角色</span>
                  <select className="account-select" onChange={(event) => setEditRole(event.target.value as "readonly" | "admin")} value={editRole}>
                    <option value="readonly">只读</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
              </div>

              <label className="account-field">
                <span className="account-field-label">关联员工</span>
                <EmployeePicker
                  departments={pickerDepartments}
                  employees={pickerEmployees}
                  onChange={setEditEmpIds}
                  selectedIds={editEmpIds}
                  showFieldChrome={false}
                />
              </label>

              <label className="account-field">
                <span className="account-field-label">关联部门</span>
                <PickerSummaryField
                  buttonLabel="选择"
                  onClick={() => {
                    setDraftDepartmentIds(editDeptIds);
                    setDepartmentContext("edit");
                  }}
                  value={summarizeDepartments(editDeptIds, departments)}
                />
              </label>

              <label className="account-field">
                <span className="account-field-label">编辑页面权限</span>
                <PickerSummaryField
                  buttonLabel="选择"
                  onClick={() => setPermissionContext("edit")}
                  value={summarizePermissions(editPermissionKeys)}
                />
              </label>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setEditingUser(null)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" onClick={saveEdit} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {permissionContext ? (
        <div className="master-modal-backdrop">
          <div className="master-modal account-permission-modal">
            <div className="master-modal-header">
              <h2>{permissionContext === "create" ? "创建账号页面权限" : permissionContext === "edit" ? "编辑页面权限" : "批量修改页面权限"}</h2>
              <button className="master-modal-close" onClick={() => setPermissionContext(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <div className="account-grid-two">
                <label className="account-field">
                  <span className="account-field-label">搜索权限</span>
                  <input className="account-input" onChange={(event) => setPermissionKeyword(event.target.value)} placeholder="搜索页面名称" value={permissionKeyword} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">权限分组</span>
                  <select className="account-select" onChange={(event) => setPermissionGroup(event.target.value)} value={permissionGroup}>
                    <option value="">全部</option>
                    <option value="管理人员">管理人员</option>
                    <option value="员工">员工</option>
                  </select>
                </label>
              </div>
              <div className="account-permission-list">
                {filteredPermissionRows.map((row) => (
                  <label className="master-check-option" key={row.key}>
                    <input
                      checked={currentPermissionKeys().includes(row.key)}
                      onChange={(event) =>
                        setCurrentPermissionKeys(
                          event.target.checked
                            ? Array.from(new Set([...currentPermissionKeys(), row.key]))
                            : currentPermissionKeys().filter((key) => key !== row.key),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{row.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setPermissionContext(null)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" onClick={() => setPermissionContext(null)} type="button">确定</button>
            </div>
          </div>
        </div>
      ) : null}

      {departmentContext ? (
        <div className="master-modal-backdrop">
          <div className="master-modal account-department-modal">
            <div className="master-modal-header">
              <h2>{departmentContext === "batch" ? "批量修改关联部门" : "选择关联部门"}</h2>
              <button className="master-modal-close" onClick={() => setDepartmentContext(null)} type="button">×</button>
            </div>
            <div className="master-modal-body">
              <label className="account-field">
                <span className="account-field-label">搜索部门名称/编号</span>
                <input className="account-input" onChange={(event) => setDepartmentKeyword(event.target.value)} value={departmentKeyword} />
              </label>
              <div className="account-permission-list">
                {filteredDepartmentRows.map((department) => (
                  <label className="master-check-option" key={department.id}>
                    <input
                      checked={draftDepartmentIds.includes(department.id)}
                      onChange={(event) =>
                        setDraftDepartmentIds((current) =>
                          event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{department.dept_name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setDepartmentContext(null)} type="button">取消</button>
              <button className="account-action-button account-action-button--primary" onClick={commitDepartmentSelection} type="button">确定</button>
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
            <div className="master-modal-body">
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
            <div className="master-modal-body">
              <p className="master-form-text">选择后将直接覆盖所选账号的关联部门；留空并确认表示清空关联部门。</p>
              <div className="account-permission-list">
                {departments.map((department) => (
                  <label className="master-check-option" key={department.id}>
                    <input
                      checked={draftDepartmentIds.includes(department.id)}
                      onChange={(event) =>
                        setDraftDepartmentIds((current) =>
                          event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{department.dept_name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="master-modal-footer">
              <button className="account-action-button" onClick={() => setBatchDepartmentOpen(false)} type="button">取消</button>
              <button
                className="account-action-button account-action-button--primary"
                onClick={async () => {
                  if (await runBatch("update_departments", { dept_ids: draftDepartmentIds })) {
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
    </main>
  );
}

function PickerSummaryField({
  value,
  onClick,
  buttonLabel,
}: {
  value: string;
  onClick: () => void;
  buttonLabel: string;
}) {
  return (
    <div className="account-picker-summary">
      <input className="account-input" readOnly value={value} />
      <button className="account-action-button" onClick={onClick} type="button">
        {buttonLabel}
      </button>
    </div>
  );
}

function permissionMap(keys: string[]): Record<string, boolean> {
  return Object.fromEntries(allPermissionKeys.map((key) => [key, keys.includes(key)]));
}

function summarizePermissions(keys: string[]): string {
  const labels = permissionCatalog.filter((row) => keys.includes(row.key)).map((row) => row.label);
  return labels.length ? labels.join("、") : "未选择页面权限";
}

function summarizeDepartments(ids: number[], departments: AdminDepartment[]): string {
  const labels = departments.filter((department) => ids.includes(department.id)).map((department) => department.dept_name);
  return labels.length ? labels.join("、") : "未选择关联部门";
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

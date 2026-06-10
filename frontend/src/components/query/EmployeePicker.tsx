import { useDeferredValue, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DepartmentOption as QueryDepartment, QueryEmployee } from "../../types/query";


interface EmployeePickerProps {
  departments?: QueryDepartment[];
  employees: QueryEmployee[];
  filterMode?: "all" | "manager" | "employee";
  label?: string;
  showFieldChrome?: boolean;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  singleSelect?: boolean;
}

type DepartmentFilter = number | "all";

interface DepartmentNode {
  id: number;
  label: string;
  parentId: number | null;
}

export default function EmployeePicker({
  departments = [],
  employees,
  filterMode = "all",
  label = "员工范围",
  showFieldChrome = true,
  selectedIds,
  onChange,
  singleSelect = false,
}: EmployeePickerProps) {
  const [draftSelectedIds, setDraftSelectedIds] = useState<number[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [quickKeyword, setQuickKeyword] = useState("");
  const [isQuickListOpen, setIsQuickListOpen] = useState(false);
  const [isInputEditing, setIsInputEditing] = useState(false);
  const [activeDeptId, setActiveDeptId] = useState<DepartmentFilter>("all");
  const [expandedDeptIds, setExpandedDeptIds] = useState<Set<number>>(new Set());
  const deferredKeyword = useDeferredValue(keyword);

  const eligibleEmployees = useMemo(
    () => employees.filter((employee) => matchesFilterMode(employee, filterMode)),
    [employees, filterMode],
  );
  const deptHierarchy = useMemo(
    () => createDepartmentHierarchy(departments, eligibleEmployees),
    [departments, eligibleEmployees],
  );
  const visibleDeptNodes = useMemo(
    () => flattenVisibleDepartments(deptHierarchy, expandedDeptIds),
    [deptHierarchy, expandedDeptIds],
  );
  const filteredEmployees = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase();
    const activeDeptScope =
      activeDeptId === "all" ? null : collectDepartmentScope(deptHierarchy, activeDeptId);
    return eligibleEmployees.filter((employee) => {
      if (activeDeptScope && !activeDeptScope.has(employee.dept_id ?? -1)) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }

      return [employee.emp_no, employee.name, employee.dept_name || "未分配部门"]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  }, [activeDeptId, deferredKeyword, deptHierarchy, eligibleEmployees]);
  const draftSelectedEmployees = useMemo(() => {
    const selectedIdSet = new Set(draftSelectedIds);
    return eligibleEmployees.filter((employee) => selectedIdSet.has(employee.id));
  }, [draftSelectedIds, eligibleEmployees]);
  const allVisibleSelected =
    filteredEmployees.length > 0 &&
    filteredEmployees.every((employee) => draftSelectedIds.includes(employee.id));
  const summaryText = selectedIds.length
    ? summarizeSelection(selectedIds, eligibleEmployees)
    : "未选择员工时，将按当前账号可见范围查询全部员工。";
  const inputSummary = summarizeInputValue(selectedIds, eligibleEmployees);
  const quickFilteredEmployees = useMemo(() => {
    const normalizedKeyword = normalizeEmployeeKeyword(quickKeyword);
    return eligibleEmployees.filter((employee) => {
      if (!normalizedKeyword) {
        return true;
      }
      return normalizeEmployeeKeyword(`${employee.emp_no} ${employee.name} ${employee.dept_name}`).includes(
        normalizedKeyword,
      );
    });
  }, [eligibleEmployees, quickKeyword]);
  const allQuickSelected =
    quickFilteredEmployees.length > 0 &&
    quickFilteredEmployees.every((employee) => selectedIds.includes(employee.id));

  function openPicker() {
    setIsQuickListOpen(false);
    setIsInputEditing(false);
    setDraftSelectedIds(selectedIds);
    setKeyword("");
    setActiveDeptId("all");
    setExpandedDeptIds(new Set());
    setIsOpen(true);
  }

  function closePicker() {
    setIsOpen(false);
    setKeyword("");
    setActiveDeptId("all");
    setExpandedDeptIds(new Set());
  }

  function confirmPicker() {
    onChange(draftSelectedIds);
    closePicker();
  }

  function toggleDraftEmployee(employeeId: number) {
    if (singleSelect) {
      setDraftSelectedIds([employeeId]);
    } else {
      setDraftSelectedIds((currentIds) =>
        currentIds.includes(employeeId)
          ? currentIds.filter((id) => id !== employeeId)
          : [...currentIds, employeeId],
      );
    }
  }

  function toggleSelectVisible() {
    if (!filteredEmployees.length) {
      return;
    }

    setDraftSelectedIds((currentIds) => {
      const visibleIds = filteredEmployees.map((employee) => employee.id);
      if (visibleIds.every((id) => currentIds.includes(id))) {
        return currentIds.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...currentIds, ...visibleIds]));
    });
  }

  function clearDraftSelection() {
    setDraftSelectedIds([]);
  }

  function clearSelectedValue() {
    onChange([]);
    setQuickKeyword("");
    setIsInputEditing(false);
    setIsQuickListOpen(false);
  }

  function toggleCommittedEmployee(employeeId: number) {
    if (singleSelect) {
      onChange([employeeId]);
      setIsQuickListOpen(false);
      setQuickKeyword("");
      setIsInputEditing(false);
    } else {
      onChange(
        selectedIds.includes(employeeId)
          ? selectedIds.filter((id) => id !== employeeId)
          : [...selectedIds, employeeId],
      );
    }
  }

  function toggleQuickVisibleEmployees() {
    if (!quickFilteredEmployees.length) {
      return;
    }
    const quickIds = quickFilteredEmployees.map((employee) => employee.id);
    if (quickIds.every((id) => selectedIds.includes(id))) {
      onChange(selectedIds.filter((id) => !quickIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selectedIds, ...quickIds])));
    }
  }

  function handleInputFocus() {
    setIsInputEditing(true);
    setQuickKeyword("");
    setIsQuickListOpen(true);
  }

  function handleInputChange(value: string) {
    setIsInputEditing(true);
    setQuickKeyword(value);
    setIsQuickListOpen(true);
  }

  function handleInputBlur() {
    window.setTimeout(() => {
      setIsQuickListOpen(false);
      setIsInputEditing(false);
      setQuickKeyword("");
    }, 0);
  }

  function toggleDepartment(deptId: number) {
    setExpandedDeptIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(deptId)) {
        nextIds.delete(deptId);
      } else {
        nextIds.add(deptId);
      }
      return nextIds;
    });
  }

  const isTestEnv =
    (typeof window !== "undefined" && (window as any).process?.env?.NODE_ENV === "test") ||
    ((globalThis as any).process?.env?.NODE_ENV === "test");

  const modalContent = (
    <div
      className="employee-picker-modal"
      role="dialog"
      aria-label="选择员工"
      aria-modal="true"
    >
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">选择员工</h5>
            <button
              aria-label="Close"
              className="btn-close"
              onClick={closePicker}
              type="button"
            />
          </div>
          <div className="modal-body">
            <div className="row g-3 employee-picker-layout">
              <div className="col-lg-7 d-flex flex-column gap-2 legacy-picker-left-column">
                <div className="employee-picker-panel employee-picker-tree" role="region" aria-label="部门树">
                  <div className="employee-picker-panel-title">部门树</div>
                  <div className="list-group employee-dept-list">
                    <button
                      className={`list-group-item list-group-item-action dept-tree-all ${
                        activeDeptId === "all" ? "active" : ""
                      }`}
                      onClick={() => setActiveDeptId("all")}
                      type="button"
                    >
                      全部部门
                    </button>
                    {visibleDeptNodes.map(({ node, level }) => {
                      const children = deptHierarchy.children.get(node.id) ?? [];
                      const hasChildren = children.length > 0;
                      const isExpanded = expandedDeptIds.has(node.id);
                      const isActive = activeDeptId === node.id;

                      return (
                        <div
                          className={`dept-tree-row ${isActive ? "active" : ""}`}
                          data-id={node.id}
                          key={node.id}
                          style={{ "--dept-level": level } as CSSProperties}
                        >
                          <button
                            aria-label={`${isExpanded ? "收起" : "展开"} ${node.label}`}
                            className={`dept-tree-toggle${hasChildren ? "" : " is-empty"}`}
                            onClick={() => toggleDepartment(node.id)}
                            type="button"
                          >
                            {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
                          </button>
                          <button
                            className="dept-tree-label"
                            onClick={() => setActiveDeptId(node.id)}
                            type="button"
                          >
                            {node.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="employee-picker-panel employee-picker-candidates" role="region" aria-label="候选员工">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <label className="form-check-label small d-inline-flex align-items-center gap-1 text-nowrap">
                      <input
                        checked={allVisibleSelected}
                        className="form-check-input m-0"
                        onChange={toggleSelectVisible}
                        type="checkbox"
                      />
                      全选
                    </label>
                    <input
                      className="form-control form-control-sm"
                      onChange={(event) => setKeyword(event.target.value)}
                      placeholder="搜索员工编号/姓名"
                      type="text"
                      value={keyword}
                    />
                  </div>
                  <div className="employee-picker-list">
                    {filteredEmployees.length ? (
                      filteredEmployees.map((employee) => {
                        const candidateLabel = `${employee.emp_no} - ${employee.name}`;
                        return (
                          <label
                            className="employee-picker-row"
                            data-dept-id={employee.dept_id ?? ""}
                            data-dept-name={employee.dept_name || "未分配部门"}
                            data-id={employee.id}
                            data-key={`${employee.emp_no} ${employee.name}`}
                            data-name={employee.name}
                            key={employee.id}
                          >
                            <div className="employee-item-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <input
                                aria-label={candidateLabel}
                                checked={draftSelectedIds.includes(employee.id)}
                                className="form-check-input employee-picker-item"
                                data-id={employee.id}
                                onChange={() => toggleDraftEmployee(employee.id)}
                                type={singleSelect ? "radio" : "checkbox"}
                                name={singleSelect ? "employee-picker-radio" : undefined}
                                value={employee.id}
                              />
                              <span className="employee-picker-main">{candidateLabel}</span>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="employee-selected-empty">无匹配员工</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="col-lg-5">
                <div className="employee-picker-panel employee-picker-selected-wrap" role="region" aria-label="已选人员">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div className="employee-picker-panel-title mb-0">已选人员</div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge text-bg-light border">已选 {draftSelectedIds.length} 人</span>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={clearDraftSelection}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="employee-selected-list">
                    {draftSelectedEmployees.length ? (
                      draftSelectedEmployees.map((employee) => (
                        <div className="employee-selected-row" key={`selected-${employee.id}`}>
                          <div>
                            <div className="employee-selected-main">{employee.name}</div>
                            <div className="employee-selected-sub">
                              {employee.dept_name || "未分配部门"}
                            </div>
                          </div>
                          <button
                            className="btn btn-sm btn-outline-secondary employee-selected-remove"
                            onClick={() => toggleDraftEmployee(employee.id)}
                            type="button"
                          >
                            移除
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="employee-selected-empty">暂无已选人员</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={closePicker} type="button">
              取消
            </button>
            <button className="btn btn-primary" onClick={confirmPicker} type="button">
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={showFieldChrome ? "legacy-field" : "employee-picker-inline-field"}>
      {showFieldChrome ? <span className="legacy-field-label">{label}</span> : null}
      <div className={`employee-lookup${selectedIds.length ? " has-clear" : ""}`}>
        <div className="input-group input-group-sm">
          <input
            className="form-control form-control-sm"
            onBlur={handleInputBlur}
            onChange={(event) => handleInputChange(event.target.value)}
            onFocus={handleInputFocus}
            placeholder="搜索员工编号/姓名"
            type="text"
            value={isInputEditing ? quickKeyword : inputSummary}
          />
          {selectedIds.length ? (
            <button
              aria-label="清空已选内容"
              className="btn btn-outline-secondary employee-lookup-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelectedValue}
              type="button"
            >
              ×
            </button>
          ) : null}
          <button
            aria-expanded={isOpen}
            className="btn btn-outline-secondary employee-picker-trigger"
            onClick={openPicker}
            title={label === "管理人员范围" ? "选择管理人员" : "选择员工"}
            type="button"
          >
            <span className="employee-picker-icon" aria-hidden="true">
              👤
            </span>
          </button>
        </div>
        <input type="hidden" value={selectedIds.join(",")} readOnly />
        <div className={`employee-float-list${isQuickListOpen ? " show" : ""}`}>
          {quickFilteredEmployees.length ? (
            <>
              {!singleSelect && (
                <button
                  className={`employee-option quick-employee-select-all${allQuickSelected ? " active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={toggleQuickVisibleEmployees}
                  type="button"
                >
                  <input
                    checked={allQuickSelected}
                    className="form-check-input quick-option-check"
                    disabled
                    readOnly
                    tabIndex={-1}
                    type="checkbox"
                  />
                  <span className="quick-option-label">{allQuickSelected ? "取消全选" : "全选"}当前列表</span>
                  <span className="quick-option-count">
                    {quickFilteredEmployees.filter((employee) => selectedIds.includes(employee.id)).length}/
                    {quickFilteredEmployees.length}
                  </span>
                </button>
              )}
              {quickFilteredEmployees.map((employee) => {
                const checked = selectedIds.includes(employee.id);
                return (
                  <button
                    className={`employee-option quick-employee-option${checked ? " active" : ""}`}
                    key={`quick-${employee.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleCommittedEmployee(employee.id)}
                    type="button"
                  >
                    <input
                      checked={checked}
                      className="form-check-input quick-option-check"
                      disabled
                      readOnly
                      tabIndex={-1}
                      type={singleSelect ? "radio" : "checkbox"}
                      name={singleSelect ? "quick-employee-picker-radio" : undefined}
                    />
                    <span className="quick-option-label">
                      {employee.emp_no} - {employee.name}
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <div className="small text-muted p-2">无匹配员工</div>
          )}
        </div>
      </div>
      {showFieldChrome ? <span className="legacy-field-hint">{summaryText}</span> : null}

      {isOpen ? (isTestEnv ? modalContent : createPortal(modalContent, document.body)) : null}

    </div>
  );
}

function matchesFilterMode(
  employee: QueryEmployee,
  filterMode: EmployeePickerProps["filterMode"],
): boolean {
  if (filterMode === "manager") {
    return employee.is_manager;
  }
  if (filterMode === "employee") {
    return !employee.is_manager;
  }
  return true;
}

function summarizeSelection(selectedIds: number[], employees: QueryEmployee[]): string {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const names = selectedIds
    .map((employeeId) => employeeMap.get(employeeId))
    .filter((employee): employee is QueryEmployee => Boolean(employee))
    .map((employee) => `${employee.emp_no} ${employee.name}`);

  if (!names.length) {
    return "未选择员工时，将按当前账号可见范围查询全部员工。";
  }

  const preview = names.slice(0, 2).join("、");
  return names.length > 2 ? `${preview} 等 ${names.length} 人` : preview;
}

function summarizeInputValue(selectedIds: number[], employees: QueryEmployee[]): string {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const names = selectedIds
    .map((employeeId) => employeeMap.get(employeeId)?.name || "")
    .filter(Boolean);

  if (!names.length) {
    return "";
  }

  return names.length <= 2 ? names.join("，") : `${names.slice(0, 2).join("，")} 等 ${names.length} 人`;
}

function normalizeEmployeeKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function createDepartmentHierarchy(departments: QueryDepartment[], employees: QueryEmployee[]) {
  const fallbackDepartments = new Map<number, DepartmentNode>();
  employees.forEach((employee) => {
    if (!employee.dept_id || fallbackDepartments.has(employee.dept_id)) {
      return;
    }
    fallbackDepartments.set(employee.dept_id, {
      id: employee.dept_id,
      label: employee.dept_name || "未分配部门",
      parentId: null,
    });
  });

  const nodes = departments.length
    ? departments.map((department) => ({
        id: department.id,
        label: department.dept_name,
        parentId: department.parent_id,
      }))
    : Array.from(fallbackDepartments.values());
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<number | "root", number[]>();
  children.set("root", []);

  nodes.forEach((node) => {
    children.set(node.id, []);
  });

  nodes.forEach((node) => {
    const parentKey =
      node.parentId && nodeMap.has(node.parentId) ? node.parentId : "root";
    children.get(parentKey)?.push(node.id);
  });

  children.forEach((ids) => {
    ids.sort((left, right) =>
      (nodeMap.get(left)?.label || "").localeCompare(nodeMap.get(right)?.label || "", "zh-CN"),
    );
  });

  return { nodes: nodeMap, children };
}

function flattenVisibleDepartments(
  hierarchy: ReturnType<typeof createDepartmentHierarchy>,
  expandedDeptIds: Set<number>,
) {
  const result: Array<{ node: DepartmentNode; level: number }> = [];

  function walk(ids: number[], level: number) {
    ids.forEach((id) => {
      const node = hierarchy.nodes.get(id);
      if (!node) {
        return;
      }
      result.push({ node, level });
      if (expandedDeptIds.has(id)) {
        walk(hierarchy.children.get(id) ?? [], level + 1);
      }
    });
  }

  walk(hierarchy.children.get("root") ?? [], 0);
  return result;
}

function collectDepartmentScope(
  hierarchy: ReturnType<typeof createDepartmentHierarchy>,
  deptId: number,
) {
  const result = new Set<number>([deptId]);
  const stack = [deptId];

  while (stack.length) {
    const currentId = stack.pop();
    if (!currentId) {
      continue;
    }
    (hierarchy.children.get(currentId) ?? []).forEach((childId) => {
      if (result.has(childId)) {
        return;
      }
      result.add(childId);
      stack.push(childId);
    });
  }

  return result;
}

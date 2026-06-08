import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AdminDepartment } from "../../types/admin";
import { useConfirm } from "../../components/feedback/ConfirmDialog";

interface DepartmentMultiPickerProps {
  departments: AdminDepartment[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  label?: string;
  showFieldChrome?: boolean;
}

interface DepartmentTreeNode {
  department: AdminDepartment;
  level: number;
}

function buildDepartmentTreeRows(rows: AdminDepartment[], expandedIds: Set<number>): DepartmentTreeNode[] {
  const childrenByParent = new Map<number | null, AdminDepartment[]>();
  rows.forEach((row) => {
    const key = row.parent_id ?? null;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), row]);
  });
  childrenByParent.forEach((children) => {
    children.sort((left, right) =>
      `${left.dept_no ?? ""}${left.dept_name}`.localeCompare(`${right.dept_no ?? ""}${right.dept_name}`, "zh-Hans-CN", {
        numeric: true,
      }),
    );
  });

  const result: DepartmentTreeNode[] = [];
  function walk(parentId: number | null, level: number) {
    (childrenByParent.get(parentId) ?? []).forEach((department) => {
      result.push({ department, level });
      if (expandedIds.has(department.id)) {
        walk(department.id, level + 1);
      }
    });
  }
  walk(null, 0);
  return result;
}

export default function DepartmentMultiPicker({
  departments,
  selectedIds,
  onChange,
  label = "关联部门",
  showFieldChrome = true,
}: DepartmentMultiPickerProps) {
  const confirm = useConfirm();
  const [isInputEditing, setIsInputEditing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [isQuickListOpen, setIsQuickListOpen] = useState(false);

  // Modal State
  const [isOpen, setIsOpen] = useState(false);
  const [pickerKeyword, setPickerKeyword] = useState("");
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<number>>(new Set());
  const [draftSelectedIds, setDraftSelectedIds] = useState<number[]>([]);

  const filteredDepartments = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return departments;
    }
    return departments.filter((dept) =>
      `${dept.dept_no ?? ""} ${dept.dept_name}`.toLowerCase().includes(normalizedKeyword),
    );
  }, [departments, keyword]);

  const inputSummary =
    selectedIds.length === 0
      ? ""
      : selectedIds.length === 1
      ? (departments.find((d) => d.id === selectedIds[0])?.dept_name ?? "已选 1 个部门")
      : `已选 ${selectedIds.length} 个部门`;

  const allVisibleSelected =
    filteredDepartments.length > 0 &&
    filteredDepartments.every((dept) => selectedIds.includes(dept.id));

  function handleInputFocus() {
    setIsInputEditing(true);
    setKeyword("");
    setIsQuickListOpen(true);
  }

  function handleInputChange(value: string) {
    setIsInputEditing(true);
    setKeyword(value);
    setIsQuickListOpen(true);
  }

  function handleInputBlur() {
    window.setTimeout(() => {
      setIsQuickListOpen(false);
      setIsInputEditing(false);
      setKeyword("");
    }, 200);
  }

  function getAllSubDepartmentIds(deptId: number): number[] {
    const result: number[] = [];
    function walk(id: number) {
      const children = departments.filter((d) => d.parent_id === id);
      children.forEach((child) => {
        result.push(child.id);
        walk(child.id);
      });
    }
    walk(deptId);
    return result;
  }

  async function toggleDepartment(deptId: number) {
    const isChecked = selectedIds.includes(deptId);
    const subIds = getAllSubDepartmentIds(deptId);

    if (subIds.length > 0) {
      if (!isChecked) {
        if (await confirm("该部门包含子部门，是否同时选中所有子部门？")) {
          onChange(Array.from(new Set([...selectedIds, deptId, ...subIds])));
        } else {
          onChange([...selectedIds, deptId]);
        }
      } else {
        if (await confirm("该部门包含子部门，是否同时取消选中所有子部门？")) {
          onChange(selectedIds.filter((id) => id !== deptId && !subIds.includes(id)));
        } else {
          onChange(selectedIds.filter((id) => id !== deptId));
        }
      }
    } else {
      onChange(isChecked ? selectedIds.filter((id) => id !== deptId) : [...selectedIds, deptId]);
    }
  }

  function toggleVisibleDepartments() {
    if (!filteredDepartments.length) return;
    const visibleIds = filteredDepartments.map((d) => d.id);
    if (visibleIds.every((id) => selectedIds.includes(id))) {
      onChange(selectedIds.filter((id) => !visibleIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selectedIds, ...visibleIds])));
    }
  }

  function clearSelectedValue() {
    onChange([]);
    setKeyword("");
    setIsInputEditing(false);
    setIsQuickListOpen(false);
  }

  // Modal Logic
  const pickerRows = useMemo(() => {
    const normalizedKeyword = pickerKeyword.trim().toLowerCase();
    return buildDepartmentTreeRows(departments, expandedDepartmentIds).filter(({ department }) => {
      if (!normalizedKeyword) return true;
      return `${department.dept_no ?? ""} ${department.dept_name}`.toLowerCase().includes(normalizedKeyword);
    });
  }, [departments, expandedDepartmentIds, pickerKeyword]);

  function openPicker() {
    setDraftSelectedIds(selectedIds);
    setExpandedDepartmentIds(new Set(departments.map((row) => row.id)));
    setPickerKeyword("");
    setIsQuickListOpen(false);
    setIsInputEditing(false);
    setIsOpen(true);
  }

  function closePicker() {
    setIsOpen(false);
    setPickerKeyword("");
  }

  function confirmPicker() {
    onChange(draftSelectedIds);
    closePicker();
  }

  function toggleTreeExpansion(departmentId: number) {
    setExpandedDepartmentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(departmentId)) {
        nextIds.delete(departmentId);
      } else {
        nextIds.add(departmentId);
      }
      return nextIds;
    });
  }

  async function toggleDraftDepartment(deptId: number) {
    const isChecked = draftSelectedIds.includes(deptId);
    const subIds = getAllSubDepartmentIds(deptId);

    if (subIds.length > 0) {
      if (!isChecked) {
        if (await confirm("该部门包含子部门，是否同时选中所有子部门？")) {
          setDraftSelectedIds((current) => Array.from(new Set([...current, deptId, ...subIds])));
        } else {
          setDraftSelectedIds((current) => [...current, deptId]);
        }
      } else {
        if (await confirm("该部门包含子部门，是否同时取消选中所有子部门？")) {
          setDraftSelectedIds((current) => current.filter((id) => id !== deptId && !subIds.includes(id)));
        } else {
          setDraftSelectedIds((current) => current.filter((id) => id !== deptId));
        }
      }
    } else {
      setDraftSelectedIds((current) => isChecked ? current.filter((id) => id !== deptId) : [...current, deptId]);
    }
  }

  const isTestEnv =
    (typeof window !== "undefined" && (window as any).process?.env?.NODE_ENV === "test") ||
    ((globalThis as any).process?.env?.NODE_ENV === "test");

  const modalContent = (
    <div aria-label="选择关联部门" aria-modal="true" className="employee-picker-modal department-picker-modal" role="dialog">
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">选择关联部门（多选）</h5>
            <button aria-label="Close" className="btn-close" onClick={closePicker} type="button" />
          </div>
          <div className="modal-body">
            <div className="row g-3 employee-picker-layout">
              <div className="col-lg-7 d-flex flex-column gap-2">
                <div className="employee-picker-panel employee-picker-tree employee-picker-selected-wrap department-picker-tree-panel">
                  <div className="employee-picker-panel-title">部门树</div>
                  <div className="mb-2">
                    <input
                      className="form-control form-control-sm"
                      onChange={(event) => setPickerKeyword(event.target.value)}
                      placeholder="搜索部门名称/编号"
                      value={pickerKeyword}
                    />
                  </div>
                  <div className="list-group employee-dept-list department-picker-tree-list">
                    <button
                      className="list-group-item list-group-item-action dept-tree-all"
                      onClick={() => {
                        const allIds = departments.map((d) => d.id);
                        if (allIds.every((id) => draftSelectedIds.includes(id))) {
                          setDraftSelectedIds([]);
                        } else {
                          setDraftSelectedIds(allIds);
                        }
                      }}
                      type="button"
                    >
                      <input
                        checked={departments.length > 0 && departments.every((d) => draftSelectedIds.includes(d.id))}
                        className="form-check-input"
                        disabled
                        readOnly
                        style={{ marginRight: "8px" }}
                        tabIndex={-1}
                        type="checkbox"
                      />
                      全选 / 取消全选
                    </button>
                    {pickerRows.map(({ department, level }) => {
                      const hasChildren = departments.some((row) => row.parent_id === department.id);
                      const isExpanded = expandedDepartmentIds.has(department.id);
                      const isChecked = draftSelectedIds.includes(department.id);
                      return (
                        <div
                          className="dept-tree-row"
                          data-id={department.id}
                          key={department.id}
                          style={{ "--dept-level": level } as CSSProperties}
                        >
                          <button
                            aria-label={`${isExpanded ? "收起" : "展开"} ${department.dept_name}`}
                            className={`dept-tree-toggle${hasChildren ? "" : " is-empty"}`}
                            onClick={() => toggleTreeExpansion(department.id)}
                            type="button"
                          >
                            {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
                          </button>
                          <button
                            className="dept-tree-label"
                            onClick={() => toggleDraftDepartment(department.id)}
                            style={{ display: "flex", alignItems: "center", gap: "8px" }}
                            type="button"
                          >
                            <input
                              checked={isChecked}
                              className="form-check-input m-0"
                              disabled
                              readOnly
                              tabIndex={-1}
                              type="checkbox"
                            />
                            {department.dept_name}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="col-lg-5">
                <div className="employee-picker-panel employee-picker-selected-wrap department-picker-selected-panel">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div className="employee-picker-panel-title mb-0">已选择部门 ({draftSelectedIds.length})</div>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setDraftSelectedIds([])} type="button">
                      清空
                    </button>
                  </div>
                  <div className="employee-selected-list">
                    {draftSelectedIds.length > 0 ? (
                      draftSelectedIds.map((id) => {
                        const dept = departments.find((d) => d.id === id);
                        if (!dept) return null;
                        return (
                          <div className="employee-selected-row" key={id}>
                            <div>
                              <div className="employee-selected-main">{dept.dept_name}</div>
                              <div className="employee-selected-sub">{dept.dept_no || "无编号"}</div>
                            </div>
                            <button
                              aria-label={`移除部门 ${dept.dept_name}`}
                              className="employee-selected-remove"
                              onClick={() => toggleDraftDepartment(id)}
                              title="移除该部门"
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="employee-selected-empty">未选择部门</div>
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
    <>
      <div className={showFieldChrome ? "legacy-field" : "employee-picker-inline-field"}>
        {showFieldChrome ? <span className="legacy-field-label">{label}</span> : null}
        <div className={`employee-lookup${selectedIds.length ? " has-clear" : ""}`}>
          <div className="input-group input-group-sm">
            <input
              className="form-control form-control-sm"
              onBlur={handleInputBlur}
              onChange={(event) => handleInputChange(event.target.value)}
              onFocus={handleInputFocus}
              placeholder="搜索部门编号/名称"
              type="text"
              value={isInputEditing ? keyword : inputSummary}
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
              title="展开选择面板"
              type="button"
            >
              <span className="employee-picker-icon" aria-hidden="true">
                🏢
              </span>
            </button>
          </div>
          <div className={`employee-float-list${isQuickListOpen ? " show" : ""}`}>
            {filteredDepartments.length ? (
              <>
                <button
                  className={`employee-option quick-employee-select-all${allVisibleSelected ? " active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={toggleVisibleDepartments}
                  type="button"
                >
                  <input
                    checked={allVisibleSelected}
                    className="form-check-input quick-option-check"
                    disabled
                    readOnly
                    tabIndex={-1}
                    type="checkbox"
                  />
                  <span className="quick-option-label">{allVisibleSelected ? "取消全选" : "全选"}当前列表</span>
                  <span className="quick-option-count">
                    {filteredDepartments.filter((d) => selectedIds.includes(d.id)).length}/
                    {filteredDepartments.length}
                  </span>
                </button>
                {filteredDepartments.map((dept) => {
                  const checked = selectedIds.includes(dept.id);
                  return (
                    <button
                      className={`employee-option quick-employee-option${checked ? " active" : ""}`}
                      key={dept.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => toggleDepartment(dept.id)}
                      type="button"
                    >
                      <input
                        checked={checked}
                        className="form-check-input quick-option-check"
                        disabled
                        readOnly
                        tabIndex={-1}
                        type="checkbox"
                      />
                      <span className="quick-option-label">{dept.dept_name}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="small text-muted p-2">无匹配部门</div>
            )}
          </div>
        </div>
      </div>
      {isOpen ? (isTestEnv ? modalContent : createPortal(modalContent, document.body)) : null}
    </>
  );
}

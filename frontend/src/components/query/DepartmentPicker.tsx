import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AdminDepartment } from "../../types/admin";


interface DepartmentPickerProps {
  departments: AdminDepartment[];
  value: string;
  onChange: (value: string) => void;
  valueMode?: "id" | "name";
  placeholder?: string;
  title?: string;
  pickerTitle?: string;
  rootOptionLabel?: string;
  quickEmptyValueLabel?: string;
  selectedEmptyLabel?: string;
  searchPlaceholder?: string;
  lookupId?: string;
  inputId?: string;
  hiddenId?: string;
  quickListId?: string;
  triggerId?: string;
  excludedId?: number;
  modalClassName?: string;
}

interface DepartmentTreeNode {
  department: AdminDepartment;
  level: number;
}

export default function DepartmentPicker({
  departments,
  value,
  onChange,
  valueMode = "id",
  placeholder = "选择部门",
  title = "选择部门",
  pickerTitle = "选择部门",
  rootOptionLabel = "顶级部门",
  quickEmptyValueLabel = "无（顶级部门）",
  selectedEmptyLabel = "未选择（顶级部门）",
  searchPlaceholder = "搜索部门名称/编号",
  lookupId,
  inputId,
  hiddenId,
  quickListId,
  triggerId,
  excludedId,
  modalClassName = "department-picker-modal",
}: DepartmentPickerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [isQuickListOpen, setIsQuickListOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [pickerKeyword, setPickerKeyword] = useState("");
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<number>>(new Set());
  const [draftDepartmentId, setDraftDepartmentId] = useState("");

  const selectedDepartment = useMemo(() => resolveDepartment(departments, value, valueMode), [departments, value, valueMode]);
  const quickRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return departments.filter((row) => {
      if (excludedId && row.id === excludedId) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return `${row.dept_no ?? ""} ${row.dept_name}`.toLowerCase().includes(normalizedKeyword);
    });
  }, [departments, excludedId, keyword]);
  const pickerRows = useMemo(() => {
    const normalizedKeyword = pickerKeyword.trim().toLowerCase();
    return buildDepartmentTreeRows(departments, expandedDepartmentIds).filter(({ department }) => {
      if (excludedId && department.id === excludedId) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return `${department.dept_no ?? ""} ${department.dept_name}`.toLowerCase().includes(normalizedKeyword);
    });
  }, [departments, excludedId, expandedDepartmentIds, pickerKeyword]);

  function syncValue(nextDepartment: AdminDepartment | null) {
    if (valueMode === "name") {
      onChange(nextDepartment?.dept_name ?? "");
      return;
    }
    onChange(nextDepartment ? String(nextDepartment.id) : "");
  }

  function openPicker() {
    setDraftDepartmentId(selectedDepartment ? String(selectedDepartment.id) : "");
    setExpandedDepartmentIds(new Set(departments.map((row) => row.id)));
    setPickerKeyword("");
    setIsQuickListOpen(false);
    setIsEditing(false);
    setKeyword("");
    setIsOpen(true);
  }

  function closePicker() {
    setIsOpen(false);
    setPickerKeyword("");
  }

  function closeQuickList() {
    window.setTimeout(() => {
      setIsEditing(false);
      setIsQuickListOpen(false);
      setKeyword("");
    }, 0);
  }

  function toggleDepartment(departmentId: number) {
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

  function confirmPicker() {
    const nextDepartment = departments.find((row) => String(row.id) === draftDepartmentId) ?? null;
    syncValue(nextDepartment);
    closePicker();
  }

  const isTestEnv =
    (typeof window !== "undefined" && (window as any).process?.env?.NODE_ENV === "test") ||
    ((globalThis as any).process?.env?.NODE_ENV === "test");

  const modalContent = (
    <div aria-label={pickerTitle} aria-modal="true" className={`employee-picker-modal ${modalClassName}`} role="dialog">
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{pickerTitle}</h5>
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
                      placeholder={searchPlaceholder}
                      value={pickerKeyword}
                    />
                  </div>
                  <div className="list-group employee-dept-list department-picker-tree-list">
                    <button
                      className={`list-group-item list-group-item-action dept-tree-all ${draftDepartmentId === "" ? "active" : ""}`}
                      onClick={() => setDraftDepartmentId("")}
                      type="button"
                    >
                      {rootOptionLabel}
                    </button>
                    {pickerRows.map(({ department, level }) => {
                      const hasChildren = departments.some((row) => row.parent_id === department.id);
                      const isExpanded = expandedDepartmentIds.has(department.id);
                      const isActive = draftDepartmentId === String(department.id);
                      return (
                        <div
                          className={`dept-tree-row ${isActive ? "active" : ""}`}
                          data-id={department.id}
                          key={department.id}
                          style={{ "--dept-level": level } as CSSProperties}
                        >
                          <button
                            aria-label={`${isExpanded ? "收起" : "展开"} ${department.dept_name}`}
                            className={`dept-tree-toggle${hasChildren ? "" : " is-empty"}`}
                            onClick={() => toggleDepartment(department.id)}
                            type="button"
                          >
                            {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
                          </button>
                          <button className="dept-tree-label" onClick={() => setDraftDepartmentId(String(department.id))} type="button">
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
                    <div className="employee-picker-panel-title mb-0">已选择部门</div>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setDraftDepartmentId("")} type="button">
                      清空
                    </button>
                  </div>
                  <div className="employee-selected-list">
                    {draftDepartmentId ? (
                      <div className="employee-selected-row">
                        <div>
                          <div className="employee-selected-main">
                            {departments.find((row) => String(row.id) === draftDepartmentId)?.dept_name ?? ""}
                          </div>
                          <div className="employee-selected-sub">
                            {departments.find((row) => String(row.id) === draftDepartmentId)?.dept_no || "无部门编号"}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="employee-selected-empty">{selectedEmptyLabel}</div>
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

  const displayValue = selectedDepartment?.dept_name ?? "";

  return (
    <>
      <div className={`employee-lookup${value ? " has-clear" : ""}`} id={lookupId}>
        <div className="input-group input-group-sm">
          <input
            autoComplete="off"
            className="form-control"
            id={inputId}
            onBlur={closeQuickList}
            onChange={(event) => {
              const nextKeyword = event.target.value;
              setIsEditing(true);
              setIsQuickListOpen(true);
              setKeyword(nextKeyword);
              const matchedDepartment = departments.find(
                (row) =>
                  row.id !== excludedId &&
                  (row.dept_name === nextKeyword || `${row.dept_no ?? ""} - ${row.dept_name}` === nextKeyword),
              );
              syncValue(matchedDepartment ?? null);
            }}
            onFocus={() => {
              setIsEditing(true);
              setKeyword("");
              setIsQuickListOpen(true);
            }}
            placeholder={placeholder}
            value={isEditing ? keyword : displayValue}
          />
          {value ? (
            <button
              aria-label="清空已选内容"
              className="btn btn-outline-secondary employee-lookup-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                syncValue(null);
                setIsEditing(false);
                setIsQuickListOpen(false);
                setKeyword("");
              }}
              type="button"
            >
              ×
            </button>
          ) : null}
          <button
            className="btn btn-outline-secondary"
            id={triggerId}
            onClick={openPicker}
            title={title}
            type="button"
          >
            <span className="employee-picker-icon" aria-hidden="true">⎇</span>
          </button>
        </div>
        <input id={hiddenId} readOnly type="hidden" value={value} />
        <div className={`employee-float-list${isQuickListOpen ? " show" : ""}`} id={quickListId}>
          <button
            className={`employee-option dept-quick-option${!selectedDepartment ? " active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              syncValue(null);
              setIsEditing(false);
              setIsQuickListOpen(false);
              setKeyword("");
            }}
            type="button"
          >
            {quickEmptyValueLabel}
          </button>
          {quickRows.length ? (
            quickRows.map((row) => (
              <button
                className={`employee-option dept-quick-option${selectedDepartment?.id === row.id ? " active" : ""}`}
                key={row.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  syncValue(row);
                  setIsEditing(false);
                  setIsQuickListOpen(false);
                  setKeyword("");
                }}
                type="button"
              >
                {row.dept_name}
              </button>
            ))
          ) : (
            <div className="small text-muted p-2">无匹配部门</div>
          )}
        </div>
      </div>

      {isOpen ? (isTestEnv ? modalContent : createPortal(modalContent, document.body)) : null}

    </>
  );
}

function resolveDepartment(
  departments: AdminDepartment[],
  value: string,
  valueMode: "id" | "name",
) {
  if (!value) {
    return null;
  }
  if (valueMode === "name") {
    return departments.find((row) => row.dept_name === value) ?? null;
  }
  return departments.find((row) => String(row.id) === value) ?? null;
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

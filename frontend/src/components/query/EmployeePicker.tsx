import { useDeferredValue, useMemo, useState } from "react";
import type { QueryEmployee } from "../../types/query";

interface EmployeePickerProps {
  employees: QueryEmployee[];
  filterMode?: "all" | "manager" | "employee";
  label?: string;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

export default function EmployeePicker({
  employees,
  filterMode = "all",
  label = "员工范围",
  selectedIds,
  onChange,
}: EmployeePickerProps) {
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);

  const filteredEmployees = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase();
    return employees.filter((employee) => {
      if (filterMode === "manager" && !employee.is_manager) {
        return false;
      }
      if (filterMode === "employee" && employee.is_manager) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return (
        employee.emp_no.toLowerCase().includes(normalizedKeyword) ||
        employee.name.toLowerCase().includes(normalizedKeyword) ||
        employee.dept_name.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [deferredKeyword, employees, filterMode]);

  function handleSelectionChange(nextValues: string[]) {
    onChange(nextValues.map((value) => Number(value)));
  }

  return (
    <label className="legacy-field">
      <span className="legacy-field-label">{label}</span>
      <div className="legacy-employee-picker">
        <div className="legacy-employee-picker-search">
          <input
            className="legacy-input"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索工号、姓名或部门"
            value={keyword}
          />
        </div>
        <select
          className="legacy-select legacy-multi-select"
          multiple
          onChange={(event) => {
            handleSelectionChange(Array.from(event.target.selectedOptions).map((option) => option.value));
          }}
          size={Math.min(Math.max(filteredEmployees.length, 6), 10)}
          value={selectedIds.map(String)}
        >
          {filteredEmployees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.emp_no} - {employee.name} / {employee.dept_name || "未分配部门"}
            </option>
          ))}
        </select>
      </div>
      <span className="legacy-field-hint">
        已选 {selectedIds.length || 0} 人；如不选择，则按当前账号可见范围查询全部员工。
      </span>
    </label>
  );
}

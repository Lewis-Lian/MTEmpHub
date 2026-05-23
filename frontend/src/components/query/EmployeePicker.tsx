import type { CSSProperties } from "react";
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
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索工号、姓名或部门"
        style={inputStyle}
        value={keyword}
      />
      <select
        multiple
        onChange={(event) => {
          handleSelectionChange(Array.from(event.target.selectedOptions).map((option) => option.value));
        }}
        size={Math.min(Math.max(filteredEmployees.length, 6), 10)}
        style={selectStyle}
        value={selectedIds.map(String)}
      >
        {filteredEmployees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.emp_no} - {employee.name} / {employee.dept_name || "未分配部门"}
          </option>
        ))}
      </select>
      <span style={hintStyle}>
        已选 {selectedIds.length || 0} 人；如果不选择，默认按当前账号可见范围查询全部。
      </span>
    </label>
  );
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const labelStyle: CSSProperties = {
  fontWeight: 600,
  color: "#183153",
};

const inputStyle: CSSProperties = {
  borderRadius: "12px",
  border: "1px solid #d7dfd4",
  padding: "12px 14px",
};

const selectStyle: CSSProperties = {
  borderRadius: "16px",
  border: "1px solid #d7dfd4",
  padding: "8px",
  minHeight: "180px",
  background: "#fffdfa",
};

const hintStyle: CSSProperties = {
  fontSize: "12px",
  color: "#5c6f68",
  lineHeight: 1.6,
};

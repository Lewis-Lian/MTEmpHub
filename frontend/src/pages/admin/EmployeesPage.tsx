import AdminResourcePage from "./AdminResourcePage";

export default function EmployeesPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "emp_no", label: "工号" },
        { key: "name", label: "姓名" },
        { key: "dept_name", label: "部门" },
        { key: "shift_no", label: "班次编号" },
        { key: "is_manager", label: "管理人员", format: (value) => (value ? "是" : "否") },
      ]}
      description="查看员工主数据列表。后续会继续迁移编辑、导入和导出能力。"
      endpoint="/api/admin/employees"
      title="员工管理"
    />
  );
}

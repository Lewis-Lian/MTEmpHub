import AdminResourcePage from "./AdminResourcePage";

export default function DepartmentsPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "dept_no", label: "部门编号" },
        { key: "dept_name", label: "部门名称" },
        { key: "parent_id", label: "上级部门ID" },
      ]}
      description="查看部门主数据层级。"
      endpoint="/api/admin/departments"
      title="部门管理"
    />
  );
}

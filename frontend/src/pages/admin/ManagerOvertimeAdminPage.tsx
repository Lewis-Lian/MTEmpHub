import AdminResourcePage from "./AdminResourcePage";

export default function ManagerOvertimeAdminPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "dept_name", label: "部门" },
        { key: "name", label: "姓名" },
        { key: "remaining", label: "剩余调休天数" },
        { key: "remark", label: "备注" },
      ]}
      description="查看后台维护的管理人员加班统计结果。"
      endpoint="/api/admin/manager-overtime"
      title="管理人员加班"
    />
  );
}

import AdminResourcePage from "./AdminResourcePage";

export default function ManagerAnnualLeaveAdminPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "dept_name", label: "部门" },
        { key: "name", label: "姓名" },
        { key: "remaining", label: "剩余年休天数" },
        { key: "remark", label: "备注" },
      ]}
      description="查看后台维护的管理人员年休统计结果。"
      endpoint="/api/admin/manager-annual-leave"
      title="管理人员年休"
    />
  );
}

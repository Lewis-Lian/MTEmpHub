import AdminResourcePage from "./AdminResourcePage";

export default function ManagerAttendanceOverridesPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "month", label: "月份" },
        { key: "emp_no", label: "工号" },
        { key: "name", label: "姓名" },
        { key: "attendance_days", label: "出勤天数" },
        { key: "remark", label: "备注" },
      ]}
      description="查看管理人员考勤修正记录列表。"
      endpoint="/api/admin/manager-attendance-overrides"
      title="管理人员考勤修正"
    />
  );
}

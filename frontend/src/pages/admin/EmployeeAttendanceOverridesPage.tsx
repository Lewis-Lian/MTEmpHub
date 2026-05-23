import AdminResourcePage from "./AdminResourcePage";

export default function EmployeeAttendanceOverridesPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "month", label: "月份" },
        { key: "emp_no", label: "工号" },
        { key: "name", label: "姓名" },
        { key: "attendance_days", label: "考勤天数" },
        { key: "work_hours", label: "工时" },
        { key: "remark", label: "备注" },
      ]}
      description="查看员工考勤修正记录列表。后续继续迁移编辑和导入能力。"
      endpoint="/api/admin/employee-attendance-overrides"
      title="员工考勤修正"
    />
  );
}

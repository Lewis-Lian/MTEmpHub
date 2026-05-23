import QueryPage from "./QueryPage";

export default function EmployeeDashboardPage() {
  return (
    <QueryPage
      description="按账套和员工范围查询最终考勤汇总，并支持导出工作簿。"
      employeeFilterMode="employee"
      endpoint="/api/query/employee-dashboard"
      exportPath="/api/query/employee-dashboard/export"
      fields={["month", "employees"]}
      kind="headerRows"
      options={[
        { key: "show_leave_counts", label: "显示请假次数", value: "1" },
        { key: "show_leave_durations", label: "显示请假时长", value: "1" },
      ]}
      title="员工考勤数据查询"
    />
  );
}

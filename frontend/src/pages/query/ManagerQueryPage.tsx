import QueryPage from "./QueryPage";

export default function ManagerQueryPage() {
  return (
    <QueryPage
      description="查询管理人员月度考勤结果，并支持模板导出。"
      employeeFilterMode="manager"
      endpoint="/api/query/manager-attendance"
      exportPath="/api/query/manager-attendance/export"
      fields={["month", "employees"]}
      kind="headerRows"
      options={[{ key: "show_actual_attendance_days", label: "显示实际出勤天数", value: "1" }]}
      templateExportPath="/api/query/manager-attendance/export-template"
      title="管理人员考勤数据查询"
    />
  );
}

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
      prepareQuery={(query, state) => {
        query.set("show_actual_attendance_days", state.selectedOptions.show_actual_attendance_days ? "1" : "0");
      }}
      templateExportPath="/api/query/manager-attendance/export-template"
      transformHeaderRows={(payload, state) => {
        if (state.selectedOptions.show_actual_attendance_days) {
          return payload;
        }

        const hiddenIndex = payload.headers.indexOf("实际出勤天数");
        if (hiddenIndex < 0) {
          return payload;
        }

        return {
          headers: payload.headers.filter((_, index) => index !== hiddenIndex),
          rows: payload.rows.map((row) => row.filter((_, index) => index !== hiddenIndex)),
        };
      }}
      title="管理人员考勤数据查询"
    />
  );
}

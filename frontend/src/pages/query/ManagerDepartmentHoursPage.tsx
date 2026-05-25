import QueryPage from "./QueryPage";

export default function ManagerDepartmentHoursPage() {
  return (
    <QueryPage
      columns={[
        { key: "dept_name", label: "部门名称" },
        { key: "total_hours", label: "总工时（小时）" },
      ]}
      description="按账套统计管理人员部门维度工时。"
      endpoint="/api/query/manager-department-hours"
      exportPath="/api/query/manager-department-hours/export"
      fields={["month"]}
      kind="objectRows"
      transformObjectRows={(rows) => {
        const totalHours = rows.reduce((sum, row) => sum + Number(row.total_hours || 0), 0);
        return [
          ...rows,
          {
            dept_name: "总计工时",
            total_hours: totalHours.toFixed(2),
          },
        ];
      }}
      title="管理人员部门工时"
    />
  );
}

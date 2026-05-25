import QueryPage from "./QueryPage";

export default function DepartmentHoursPage() {
  return (
    <QueryPage
      columns={[
        { key: "dept_name", label: "部门名称" },
        { key: "total_hours", label: "总工时（小时）" },
      ]}
      description="按账套查看员工部门维度的工时汇总。"
      endpoint="/api/query/department-hours"
      exportPath="/api/query/department-hours/export"
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
      title="员工部门工时"
    />
  );
}

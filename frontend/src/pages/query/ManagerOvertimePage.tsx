import QueryPage from "./QueryPage";

export default function ManagerOvertimePage() {
  return (
    <QueryPage
      description="按年份查询管理人员月度加班统计。"
      employeeFilterMode="manager"
      endpoint="/api/query/manager-overtime"
      fields={["year", "employees"]}
      kind="headerRows"
      title="管理人员加班查询"
    />
  );
}

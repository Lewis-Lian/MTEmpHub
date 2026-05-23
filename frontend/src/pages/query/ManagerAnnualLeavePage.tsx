import QueryPage from "./QueryPage";

export default function ManagerAnnualLeavePage() {
  return (
    <QueryPage
      description="按年份查询管理人员月度年休统计。"
      employeeFilterMode="manager"
      endpoint="/api/query/manager-annual-leave"
      fields={["year", "employees"]}
      kind="headerRows"
      title="管理人员年休查询"
    />
  );
}

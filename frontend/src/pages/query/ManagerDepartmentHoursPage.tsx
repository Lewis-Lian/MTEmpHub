import { ManagerDepartmentHoursIcon } from "../../components/query/QueryEmptyState";
import QueryPage from "./QueryPage";

export default function ManagerDepartmentHoursPage() {
  return (
    <QueryPage
      columns={[
        { key: "dept_name", label: "部门名称" },
        { key: "total_hours", label: "总工时（小时）" },
        { key: "member_count", label: "部门人数" },
      ]}
      description="按账套统计管理人员部门维度工时。"
      emptyState={{
        title: "请选择账套后点击查询",
        description: "在上方选择对应账套月份，即可开启管理部门工时与人员分布统计。",
        icon: <ManagerDepartmentHoursIcon />,
      }}
      endpoint="/api/query/manager-department-hours"
      exportPath="/api/query/manager-department-hours/export"
      fields={["month"]}
      kind="objectRows"
      transformObjectRows={(rows) => {
        const totalHours = rows.reduce((sum, row) => sum + Number(row.total_hours || 0), 0);
        const totalMembers = rows.reduce((sum, row) => sum + Number(row.member_count || 0), 0);
        return [
          ...rows,
          {
            dept_name: "总计工时",
            total_hours: totalHours.toFixed(2),
            member_count: totalMembers,
          },
        ];
      }}
      title="管理人员部门工时"
    />
  );
}

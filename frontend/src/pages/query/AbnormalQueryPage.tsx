import QueryPage from "./QueryPage";

export default function AbnormalQueryPage() {
  return (
    <QueryPage
      columns={[
        { key: "dept_name", label: "部门名称" },
        { key: "emp_no", label: "人员编号" },
        { key: "name", label: "人员姓名" },
        { key: "abnormal_count", label: "异常考勤次数" },
      ]}
      description="查看员工异常考勤次数，并按账套和员工范围筛选。"
      employeeFilterMode="employee"
      endpoint="/api/query/abnormal"
      exportPath="/api/query/abnormal/export"
      fields={["month", "employees"]}
      kind="objectRows"
      title="员工异常查询"
    />
  );
}

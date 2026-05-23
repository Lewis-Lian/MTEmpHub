import QueryPage from "./QueryPage";

export default function PunchRecordsPage() {
  return (
    <QueryPage
      columns={[
        { key: "date", label: "日期" },
        { key: "emp_no", label: "员工编号" },
        { key: "name", label: "员工姓名" },
        { key: "dept_name", label: "部门" },
        { key: "raw_punch_data", label: "原始打卡数据" },
        { key: "check_in_times", label: "上班打卡" },
        { key: "check_out_times", label: "下班打卡" },
        { key: "punch_count", label: "打卡次数" },
        { key: "actual_hours", label: "实出勤小时" },
        { key: "late_minutes", label: "迟到分钟" },
        { key: "early_leave_minutes", label: "早退分钟" },
        { key: "exception_reason", label: "异常原因" },
      ]}
      description="查询员工逐日打卡明细，并支持直接导出 Excel。"
      employeeFilterMode="employee"
      endpoint="/api/query/punch-records"
      exportPath="/api/query/punch-records/export"
      fields={["month", "employees"]}
      kind="objectRows"
      title="员工打卡数据查询"
    />
  );
}

import QueryPage from "./QueryPage";

export default function PunchRecordsPage() {
  return (
    <QueryPage
      columns={buildPunchColumns()}
      defaultSelectedOptions={{ show_in_out_punch: false, show_raw_punch: true }}
      description="查询员工逐日打卡明细，并支持直接导出 Excel。"
      employeeFilterMode="employee"
      endpoint="/api/query/punch-records"
      exportPath="/api/query/punch-records/export"
      fields={["month", "employees"]}
      kind="objectRows"
      options={[
        { key: "show_raw_punch", label: "原始刷卡", value: "1" },
        { key: "show_in_out_punch", label: "上下班打卡", value: "1" },
      ]}
      prepareQuery={(query, state) => {
        query.set("punch_headers", buildPunchColumns(state).map((column) => column.label).join(","));
      }}
      resolveColumns={buildPunchColumns}
      title="员工打卡数据查询"
    />
  );
}

function buildPunchColumns(state?: { selectedOptions: Record<string, boolean> }) {
  const showRawPunch = state?.selectedOptions.show_raw_punch ?? true;
  const showInOutPunch = state?.selectedOptions.show_in_out_punch ?? false;
  const columns = [
    { key: "date", label: "日期" },
    { key: "emp_no", label: "员工编号" },
    { key: "name", label: "员工姓名" },
    { key: "dept_name", label: "部门" },
  ];

  if (showRawPunch) {
    columns.push({ key: "raw_punch_data", label: "原始打卡数据" });
  }

  if (showInOutPunch) {
    columns.push({ key: "check_in_times", label: "上班打卡" });
    columns.push({ key: "check_out_times", label: "下班打卡" });
  }

  columns.push(
    { key: "punch_count", label: "打卡次数" },
    { key: "actual_hours", label: "实出勤小时" },
    { key: "late_minutes", label: "迟到分钟" },
    { key: "early_leave_minutes", label: "早退分钟" },
    { key: "exception_reason", label: "异常原因" },
  );

  return columns;
}

import AttendanceOverridesPage from "../../components/admin/AttendanceOverridesPage";

const EMPLOYEE_FIELDS = [
  { key: "attendance_days", label: "考勤天数", inputMode: "decimal" as const },
  { key: "work_hours", label: "工时", inputMode: "decimal" as const },
  { key: "half_days", label: "半勤天数", inputMode: "numeric" as const },
  { key: "late_early_minutes", label: "迟到\\早退", inputMode: "numeric" as const },
];

export default function EmployeeAttendanceOverridesPage() {
  return (
    <AttendanceOverridesPage
      editMetaEmpty="请选择列表中的员工进行编辑"
      editTitle="编辑员工考勤修正"
      endpointBase="/api/admin/employee-attendance-overrides"
      fields={EMPLOYEE_FIELDS}
      filterMode="employee"
      listEmptyHint="当前条件下暂无员工修正数据"
      metricEmployeeSub="只支持普通员工"
      metricFieldCount="4"
      metricFieldSub="考勤天数、工时、半勤天数、迟到早退"
      pickerButtonLabel="员工范围"
      pickerLabel="员工"
      queryDoneText={(count) => `已查询 ${count} 人`}
      queryLoadingText="正在加载员工修正列表"
      saveSuccessText="修正已保存"
      title="员工考勤修正"
    />
  );
}

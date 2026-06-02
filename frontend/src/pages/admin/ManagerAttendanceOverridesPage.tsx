import AttendanceOverridesPage from "../../components/admin/AttendanceOverridesPage";

const MANAGER_FIELDS = [
  { key: "attendance_days", label: "出勤天数", inputMode: "decimal" as const },
  { key: "injury_days", label: "工伤", inputMode: "decimal" as const },
  { key: "business_trip_days", label: "出差", inputMode: "decimal" as const },
  { key: "marriage_days", label: "婚假", inputMode: "decimal" as const },
  { key: "funeral_days", label: "丧假", inputMode: "decimal" as const },
  { key: "late_early_minutes", label: "迟到\\早退", inputMode: "numeric" as const },
];

export default function ManagerAttendanceOverridesPage() {
  return (
    <AttendanceOverridesPage
      editMetaEmpty="请选择列表中的管理人员进行编辑"
      editTitle="编辑管理人员考勤修正"
      endpointBase="/api/admin/manager-attendance-overrides"
      fields={MANAGER_FIELDS}
      filterMode="manager"
      listEmptyHint="当前条件下暂无管理人员修正数据"
      pickerButtonLabel="管理人员范围"
      pickerLabel="管理人员"
      saveSuccessText="修正已保存"
      title="管理人员考勤修正"
    />
  );
}

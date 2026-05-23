import AdminResourcePage from "./AdminResourcePage";

export default function ShiftsPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "shift_no", label: "班次编号" },
        { key: "shift_name", label: "班次名称" },
        { key: "is_cross_day", label: "跨天", format: (value) => (value ? "是" : "否") },
        {
          key: "time_slots",
          label: "时段",
          format: (value) => (Array.isArray(value) ? JSON.stringify(value) : ""),
        },
      ]}
      description="查看班次与时段配置。"
      endpoint="/api/admin/shifts"
      title="班次管理"
    />
  );
}

import AdminResourcePage from "./AdminResourcePage";

export default function DatabaseSettingsPage() {
  return (
    <AdminResourcePage
      title="数据库设置"
      description="查看当前系统使用的数据库连接摘要与存储位置。"
      endpoint="/api/admin/database-settings"
      columns={[
        { key: "item", label: "配置项" },
        { key: "value", label: "当前值" },
        { key: "description", label: "说明" },
      ]}
    />
  );
}

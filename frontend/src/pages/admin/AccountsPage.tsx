import AdminResourcePage from "./AdminResourcePage";

export default function AccountsPage() {
  return (
    <AdminResourcePage
      columns={[
        { key: "id", label: "ID" },
        { key: "username", label: "用户名" },
        { key: "role", label: "角色" },
        { key: "profile_emp_no", label: "绑定工号" },
        { key: "profile_name", label: "绑定姓名" },
        {
          key: "departments",
          label: "部门范围",
          format: (value) =>
            Array.isArray(value)
              ? value.map((item) => ((item as { dept_name?: string }).dept_name ?? "")).filter(Boolean).join("、")
              : "",
        },
      ]}
      description="账号管理页已经迁移到独立前端，当前先提供账号列表读取能力。"
      endpoint="/api/admin/accounts"
      title="账号管理"
    />
  );
}

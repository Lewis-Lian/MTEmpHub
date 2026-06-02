import ManagerMonthStatPage from "../../components/admin/ManagerMonthStatPage";

export default function ManagerAnnualLeaveAdminPage() {
  return (
    <ManagerMonthStatPage
      editTitle="编辑管理人员年休"
      endpointBase="/api/admin/manager-annual-leave"
      monthFields={[
        { key: "m1", label: "1月" },
        { key: "m2", label: "2月" },
        { key: "m3", label: "3月" },
        { key: "m4", label: "4月" },
        { key: "m5", label: "5月" },
        { key: "m6", label: "6月" },
        { key: "m7", label: "7月" },
        { key: "m8", label: "8月" },
        { key: "m9", label: "9月" },
        { key: "m10", label: "10月" },
        { key: "m11", label: "11月" },
        { key: "m12", label: "12月" },
      ]}
      remainingLabel="剩余年休天数"
      summaryColumns={[
        {
          key: "used_total",
          label: "年度已用",
          render: (row) =>
            String(
              ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"].reduce(
                (sum, key) => sum + Number(row[key] || 0),
                0,
              ),
            ),
        },
        { key: "remaining", label: "剩余年休天数", render: (row) => String(row.remaining ?? 0) },
      ]}
      title="管理人员年休"
    />
  );
}

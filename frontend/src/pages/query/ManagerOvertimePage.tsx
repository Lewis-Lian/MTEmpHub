import QueryPage from "./QueryPage";

export default function ManagerOvertimePage() {
  return (
    <QueryPage
      description="按年份查询管理人员月度加班统计。"
      employeeFilterMode="manager"
      endpoint="/api/query/manager-overtime"
      exportPath="/api/query/manager-overtime/export"
      fields={["year", "employees"]}
      kind="headerRows"
      transformHeaderRows={(payload) => ({
        headers: payload.headers,
        rows: payload.rows.map((row) => mapManagerOvertimeRow(row)),
      })}
      title="管理人员加班查询"
    />
  );
}

function mapManagerOvertimeRow(row: Array<string | number | null> | Record<string, unknown>) {
  if (Array.isArray(row)) {
    return row;
  }

  return [
    stringifyValue(row.dept_name),
    stringifyValue(row.name),
    stringifyValue(row.prev_dec),
    stringifyValue(row.m1),
    stringifyValue(row.m2),
    stringifyValue(row.m3),
    stringifyValue(row.m4),
    stringifyValue(row.m5),
    stringifyValue(row.m6),
    stringifyValue(row.m7),
    stringifyValue(row.m8),
    stringifyValue(row.m9),
    stringifyValue(row.m10),
    stringifyValue(row.m11),
    stringifyValue(row.m12),
    stringifyValue(row.remaining),
    stringifyValue(row.remark),
  ];
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "number" ? value : String(value);
}

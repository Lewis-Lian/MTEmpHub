import QueryPage from "./QueryPage";
import type { QueryBootstrap, HeaderRowsResponse } from "../../types/query";
import { fetchObjectRows } from "../../api/query";
import type { QueryTableCellModalConfig } from "../../components/query/QueryTable";

interface ManagerRowMeta {
  employeeId: number | null;
  employeeName: string;
  deptName: string;
  month: string;
  attendanceDays: string;
  leaveDays: string;
  lateEarlyMinutes: string;
  benefitDays: string;
  overtimeChange: string;
  monthlyBenefitDays: number;
}

interface ManagerPunchRow {
  date: string;
  dept_name?: string;
  name?: string;
  raw_punch_data?: string;
  late_minutes?: number | string;
  early_leave_minutes?: number | string;
}

interface ManagerLeaveRow {
  dept_name?: string;
  name?: string;
  leave_type?: string;
  start_time: string;
  end_time: string;
  duration?: number | string;
  reason?: string;
}

const LEAVE_BUCKET_HEADERS: Record<string, string> = {
  "事/病假": "personal_sick",
  "工伤": "injury",
  "出差": "business_trip",
  "婚假": "marriage",
  "丧假": "funeral",
};

const managerCellModal: QueryTableCellModalConfig = {
  getModal: ({ headerLabel, rowMeta }) => {
    const meta = rowMeta as ManagerRowMeta | undefined;
    if (!meta?.employeeId || !meta.month) {
      return null;
    }

    if (headerLabel === "出勤天数" || headerLabel === "实际出勤天数") {
      return {
        title: `${meta.employeeName} ${meta.month} 出勤打卡明细`,
        triggerLabel: `查看${meta.employeeName}在 ${meta.month} 的出勤打卡明细`,
        loadContent: async () => {
          const query = new URLSearchParams();
          query.set("month", meta.month);
          query.append("emp_ids", String(meta.employeeId));
          const rows = await fetchObjectRows<ManagerPunchRow>("/api/query/manager-punch-records", query);
          const validRows = rows.filter((row) => String(row.raw_punch_data || "").trim());
          if (!validRows.length) {
            return <p>当前月份暂无出勤打卡明细。</p>;
          }
          return (
            <table className="legacy-table">
              <thead>
                <tr>
                  <th className="legacy-table-head-cell"><div className="master-static-head">部门</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">姓名</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">原始打卡数据</div></th>
                </tr>
              </thead>
              <tbody>
                {validRows.map((row, index) => (
                  <tr key={`${row.date}-${index}`}>
                    <td className="legacy-table-body-cell">{row.dept_name || meta.deptName}</td>
                    <td className="legacy-table-body-cell">{row.name || meta.employeeName}</td>
                    <td className="legacy-table-body-cell">{row.raw_punch_data || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        },
      };
    }

    if (headerLabel in LEAVE_BUCKET_HEADERS) {
      return {
        title: `${meta.employeeName} ${meta.month} 请假明细`,
        triggerLabel: `查看${meta.employeeName}在 ${meta.month} 的请假明细`,
        loadContent: async () => {
          const query = new URLSearchParams();
          query.set("month", meta.month);
          query.set("leave_bucket", LEAVE_BUCKET_HEADERS[headerLabel]);
          query.append("emp_ids", String(meta.employeeId));
          const rows = await fetchObjectRows<ManagerLeaveRow>("/api/query/manager-leave-records", query);
          if (!rows.length) {
            return <p>当前月份暂无请假明细。</p>;
          }
          return (
            <table className="legacy-table">
              <thead>
                <tr>
                  <th className="legacy-table-head-cell"><div className="master-static-head">请假类型</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">开始时间</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">结束时间</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">时长</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">事由</div></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.start_time}-${index}`}>
                    <td className="legacy-table-body-cell">{row.leave_type || "-"}</td>
                    <td className="legacy-table-body-cell">{row.start_time || ""}</td>
                    <td className="legacy-table-body-cell">{row.end_time || ""}</td>
                    <td className="legacy-table-body-cell">{row.duration ?? 0}</td>
                    <td className="legacy-table-body-cell">{row.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        },
      };
    }

    if (headerLabel === "迟到\\早退") {
      return {
        title: `${meta.employeeName} ${meta.month} 迟到明细`,
        triggerLabel: `查看${meta.employeeName}在 ${meta.month} 的迟到明细`,
        loadContent: async () => {
          const query = new URLSearchParams();
          query.set("month", meta.month);
          query.append("emp_ids", String(meta.employeeId));
          const rows = await fetchObjectRows<ManagerPunchRow>("/api/query/manager-punch-records", query);
          const lateRows = rows.filter((row) => Number(row.late_minutes ?? 0) > 0);
          if (!lateRows.length) {
            return <p>当前月份暂无迟到明细。</p>;
          }
          return (
            <table className="legacy-table">
              <thead>
                <tr>
                  <th className="legacy-table-head-cell"><div className="master-static-head">日期</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">原始打卡数据</div></th>
                  <th className="legacy-table-head-cell"><div className="master-static-head">迟到分钟</div></th>
                </tr>
              </thead>
              <tbody>
                {lateRows.map((row, index) => (
                  <tr key={`${row.date}-${index}`}>
                    <td className="legacy-table-body-cell">{row.date || ""}</td>
                    <td className="legacy-table-body-cell">{row.raw_punch_data || "-"}</td>
                    <td className="legacy-table-body-cell">{row.late_minutes ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        },
      };
    }

    if (headerLabel === "福利天数") {
      return {
        title: `${meta.employeeName} ${meta.month} 福利天数说明`,
        triggerLabel: `查看${meta.employeeName}在 ${meta.month} 的福利天数说明`,
        loadContent: () => (
          <div style={{ display: "grid", gap: 8 }}>
            <p>本月福利天数：{meta.benefitDays || "0"}</p>
            <p>账套可用福利天数上限：{meta.monthlyBenefitDays}</p>
            <p>该字段表示本月用于抵扣缺口的福利天数。</p>
          </div>
        ),
      };
    }

    if (headerLabel === "加班变化") {
      return {
        title: `${meta.employeeName} ${meta.month} 加班变化说明`,
        triggerLabel: `查看${meta.employeeName}在 ${meta.month} 的加班变化说明`,
        loadContent: () => (
          <div style={{ display: "grid", gap: 8 }}>
            <p>本月加班变化：{meta.overtimeChange || "0"}</p>
            <p>正数表示当月新增加班天数，负数表示本月使用了剩余加班天数。</p>
          </div>
        ),
      };
    }

    return null;
  },
};

export default function ManagerQueryPage() {
  return (
    <QueryPage
      buildHeaderRowMeta={buildManagerRowMeta}
      cellModal={managerCellModal}
      description="查询管理人员月度考勤结果，并支持模板导出。"
      employeeFilterMode="manager"
      endpoint="/api/query/manager-attendance"
      exportPath="/api/query/manager-attendance/export"
      fields={["month", "employees"]}
      kind="headerRows"
      options={[{ key: "show_actual_attendance_days", label: "显示实际出勤天数", value: "1" }]}
      prepareQuery={(query, state) => {
        query.set("show_actual_attendance_days", state.selectedOptions.show_actual_attendance_days ? "1" : "0");
      }}
      templateExportPath="/api/query/manager-attendance/export-template"
      title="管理人员考勤数据查询"
      transformHeaderRows={(payload, state) => {
        if (state.selectedOptions.show_actual_attendance_days) {
          return payload;
        }

        const hiddenIndex = payload.headers.indexOf("实际出勤天数");
        if (hiddenIndex < 0) {
          return payload;
        }

        return {
          headers: payload.headers.filter((_, index) => index !== hiddenIndex),
          rows: payload.rows.map((row) => row.filter((_, index) => index !== hiddenIndex)),
        };
      }}
    />
  );
}

function buildManagerRowMeta(payload: HeaderRowsResponse, state: { selectedMonth: string }, bootstrap: QueryBootstrap): ManagerRowMeta[] {
  const deptIndex = payload.headers.indexOf("部   门");
  const nameIndex = payload.headers.indexOf("姓名");
  const attendanceIndex = payload.headers.indexOf("出勤天数");
  const leaveIndex = payload.headers.indexOf("事/病假");
  const lateIndex = payload.headers.indexOf("迟到\\早退");
  const benefitIndex = payload.headers.indexOf("福利天数");
  const overtimeIndex = payload.headers.indexOf("加班变化");
  const currentAccountSet = bootstrap.account_sets.find((item) => item.month === state.selectedMonth);

  return payload.rows.map((row) => {
    const deptName = deptIndex >= 0 ? String(row[deptIndex] ?? "").trim() : "";
    const employeeName = nameIndex >= 0 ? String(row[nameIndex] ?? "").trim() : "";
    const employee = bootstrap.employees.find((item) => item.name === employeeName && item.dept_name === deptName);
    return {
      employeeId: employee?.id ?? null,
      employeeName,
      deptName,
      month: state.selectedMonth,
      attendanceDays: attendanceIndex >= 0 ? String(row[attendanceIndex] ?? "") : "",
      leaveDays: leaveIndex >= 0 ? String(row[leaveIndex] ?? "") : "",
      lateEarlyMinutes: lateIndex >= 0 ? String(row[lateIndex] ?? "") : "",
      benefitDays: benefitIndex >= 0 ? String(row[benefitIndex] ?? "") : "",
      overtimeChange: overtimeIndex >= 0 ? String(row[overtimeIndex] ?? "") : "",
      monthlyBenefitDays: Number(currentAccountSet?.monthly_benefit_days ?? 0),
    };
  });
}

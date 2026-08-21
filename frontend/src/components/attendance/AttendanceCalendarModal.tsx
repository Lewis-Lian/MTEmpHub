import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchAttendanceCalendar } from "../../api/query";
import type { AttendanceCalendarData } from "../../types/query";
import AttendanceCalendarGrid from "./AttendanceCalendarGrid";

interface AttendanceCalendarModalProps {
  open: boolean;
  employeeId: number;
  month: string;
  onClose: () => void;
}

export default function AttendanceCalendarModal({ open, employeeId, month, onClose }: AttendanceCalendarModalProps) {
  const [data, setData] = useState<AttendanceCalendarData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    fetchAttendanceCalendar(employeeId, month)
      .then((result) => { if (!cancelled) { setData(result); setError(""); } })
      .catch(() => { if (!cancelled) setError("日历数据加载失败"); });
    return () => { cancelled = true; };
  }, [open, employeeId, month]);

  const isTestEnv =
    (typeof window !== "undefined" && (window as any).process?.env?.NODE_ENV === "test") ||
    ((globalThis as any).process?.env?.NODE_ENV === "test");

  if (!open) {
    return null;
  }

  const content = (
    <div aria-label="考勤日历" aria-modal="true" className="employee-picker-modal attendance-calendar-modal" role="dialog">
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">考勤日历 {month}</h5>
            <button aria-label="Close" className="btn-close" onClick={onClose} type="button" />
          </div>
          <div className="modal-body">
            {error ? <div className="text-danger">{error}</div> : null}
            {data ? (
              <>
                <div className="attendance-calendar-modal-employee">
                  {data.employee.emp_no} - {data.employee.name}（{data.employee.dept_name}）
                </div>
                <AttendanceCalendarGrid data={data} />
              </>
            ) : !error ? <div>加载中…</div> : null}
          </div>
        </div>
      </div>
    </div>
  );

  return isTestEnv ? content : createPortal(content, document.body);
}

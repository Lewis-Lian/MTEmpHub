from datetime import datetime

from . import db


class DailyAttendanceOverride(db.Model):
    """逐日考勤修正：按 (emp_id, record_date) 存储人工修正值，不改动 DailyRecord 原始数据。

    全部业务字段可空：None 表示跟随系统口径；status 为空表示当天未做状态修正。
    """

    __tablename__ = "daily_attendance_overrides"

    id = db.Column(db.Integer, primary_key=True)
    emp_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    record_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=True)
    is_evening_overtime = db.Column(db.Boolean, nullable=True)
    work_hours = db.Column(db.Float, nullable=True)
    late_minutes = db.Column(db.Integer, nullable=True)
    early_leave_minutes = db.Column(db.Integer, nullable=True)
    remark = db.Column(db.Text, nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = db.relationship("Employee")
    updated_by_user = db.relationship("User")

    __table_args__ = (
        db.UniqueConstraint("emp_id", "record_date", name="uq_daily_attendance_override"),
    )

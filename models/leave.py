from . import db


class LeaveRecord(db.Model):
    __tablename__ = "leave_records"
    __table_args__ = (
        db.Index("ix_leave_records_emp_id_start_time", "emp_id", "start_time"),
    )


    id = db.Column(db.Integer, primary_key=True)
    emp_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    leave_no = db.Column(db.String(100), unique=True, nullable=False, index=True)
    apply_date = db.Column(db.Date, nullable=True)
    leave_type = db.Column(db.String(50), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=False)
    duration = db.Column(db.Float, default=0)
    reason = db.Column(db.Text, nullable=True)
    approval_status = db.Column(db.String(50), nullable=True)
    approval_comment = db.Column(db.Text, nullable=True)
    # 作废单不参与任何考勤/扣薪口径，仅在修正弹窗中置灰展示（可恢复）
    is_revoked = db.Column(db.Boolean, default=False, nullable=False, index=True)
    # 手工编辑过的单在请假导入 upsert 时保留编辑值，不被源表覆盖
    is_manual_edited = db.Column(db.Boolean, default=False, nullable=False)

    employee = db.relationship("Employee", back_populates="leave_records")

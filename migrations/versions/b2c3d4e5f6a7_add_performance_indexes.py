"""add performance composite indexes

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-23 00:00:00.000000

为高频查询模式添加复合索引：
- leave_records(emp_id, start_time)：emp_id.in_() + 时间范围过滤的假期查询
- overtime_records(emp_id, start_time)：同模式的加班查询
- attendance_override_histories(override_type, month, created_at)：修正历史按类型+月份过滤并按时间倒序
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_leave_records_emp_id_start_time", "leave_records", ["emp_id", "start_time"])
    op.create_index("ix_overtime_records_emp_id_start_time", "overtime_records", ["emp_id", "start_time"])
    op.create_index(
        "ix_attendance_override_history_type_month_created",
        "attendance_override_histories",
        ["override_type", "month", "created_at"],
    )


def downgrade():
    op.drop_index("ix_attendance_override_history_type_month_created", table_name="attendance_override_histories")
    op.drop_index("ix_overtime_records_emp_id_start_time", table_name="overtime_records")
    op.drop_index("ix_leave_records_emp_id_start_time", table_name="leave_records")

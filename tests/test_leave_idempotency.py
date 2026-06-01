import os
import tempfile
import unittest
from datetime import datetime, timedelta
from flask import Flask

from models import db
from models.employee import Employee
from models.department import Department
from models.account_set import AccountSet
from models.leave import LeaveRecord
from models.annual_leave import AnnualLeave
from services.import_service import ImportService


class LeaveImportIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/test-idempotency.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(self.app)

        with self.app.app_context():
            db.create_all()

            # 创建基础的部门、员工和账套
            dept = Department(dept_no="D001", dept_name="行政部")
            db.session.add(dept)
            db.session.flush()

            emp = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            db.session.add(emp)
            db.session.flush()

            # 初始化员工的 2026 年调休余额为：总天数 10.0，已使用 2.0，剩余 8.0
            annual_leave = AnnualLeave(
                emp_id=emp.id,
                year=2026,
                total_days=10.0,
                used_days=2.0,
                remaining_days=8.0
            )
            db.session.add(annual_leave)
            
            # 添加本月账套，使导入生效
            db.session.add(AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False))
            db.session.commit()

            self.emp_id = emp.id

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_leave_import_idempotency_and_differential_updates(self) -> None:
        # 1. 准备请假 xlsx 的数据行（模拟）
        # 标题行包含："请假单号", "工号", "请假人", "申请日期", "请假类型", "开始时间", "结束时间", "时长", "事由文本", "部门主管意见"
        headers = ["请假单号", "工号", "请假人", "申请日期", "请假类型", "开始时间", "结束时间", "时长", "事由文本", "部门主管意见"]
        
        # 第一次导入一行数据，时长为 8 小时 (也就是 1 天)
        row_data_1 = ["L0001", "E001", "员工甲", "2026-05-10", "补休（调休）", "2026-05-10 08:00:00", "2026-05-10 17:00:00", "8", "事由", "同意"]
        rows = [headers, row_data_1]

        with self.app.app_context():
            # 运行第一次导入
            res = ImportService._import_leave(rows)
            self.assertEqual(res["imported"], 1)

            # 验证请假记录和调休已用余额
            leave_rec = LeaveRecord.query.filter_by(leave_no="L0001").first()
            self.assertIsNotNone(leave_rec)
            self.assertEqual(leave_rec.duration, 8.0)

            al = AnnualLeave.query.filter_by(emp_id=self.emp_id, year=2026).first()
            self.assertIsNotNone(al)
            # 原本是 2.0，加上此次的 8 小时（1.0天），应为 3.0 天
            self.assertEqual(al.used_days, 3.0)
            self.assertEqual(al.remaining_days, 7.0)

        # 2. 第二次导入相同的数据（重复导入，测试幂等性）
        with self.app.app_context():
            res = ImportService._import_leave(rows)
            self.assertEqual(res["imported"], 1)

            # 验证请假记录依然是同一条，且调休已用余额保持 3.0 天，没有重复累加
            leave_recs = LeaveRecord.query.filter_by(leave_no="L0001").all()
            self.assertEqual(len(leave_recs), 1)

            al = AnnualLeave.query.filter_by(emp_id=self.emp_id, year=2026).first()
            self.assertEqual(al.used_days, 3.0)
            self.assertEqual(al.remaining_days, 7.0)

        # 3. 第三次导入数据，但是修改了该请假单的时长（测试差值更新）
        # 将时长从 8 小时修改为 16 小时 (也就是 2 天)
        row_data_2 = ["L0001", "E001", "员工甲", "2026-05-10", "补休（调休）", "2026-05-10 08:00:00", "2026-05-11 17:00:00", "16", "事由", "同意"]
        rows_updated = [headers, row_data_2]

        with self.app.app_context():
            res = ImportService._import_leave(rows_updated)
            self.assertEqual(res["imported"], 1)

            # 验证请假单时长已更新为 16 小时
            leave_rec = LeaveRecord.query.filter_by(leave_no="L0001").first()
            self.assertEqual(leave_rec.duration, 16.0)

            al = AnnualLeave.query.filter_by(emp_id=self.emp_id, year=2026).first()
            # 扣减掉旧的 8/8=1.0 天，加上新的 16/8=2.0 天，最后应为 2.0 (原有) + 2.0 = 4.0 天
            self.assertEqual(al.used_days, 4.0)
            self.assertEqual(al.remaining_days, 6.0)


if __name__ == "__main__":
    unittest.main()

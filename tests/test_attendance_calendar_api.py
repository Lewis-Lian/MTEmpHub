import tempfile
import unittest
from datetime import date, datetime, timedelta

from flask import Flask

from models import db
from models.department import Department
from models.daily_record import DailyRecord
from models.employee import Employee
from models.leave import LeaveRecord
from models.overtime import OvertimeRecord
from models.user import User, UserEmployeeAssignment
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin


class AttendanceCalendarApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/cal.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="api_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            dept = Department(dept_no="D001", dept_name="制造一部")
            db.session.add(dept)
            db.session.flush()
            emp = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            db.session.add(emp)
            db.session.flush()
            # 登录与权限授予方式与 test_api_query.py 一致：
            # page_permissions 授予 attendance_calendar + UserEmployeeAssignment 绑定可见员工。
            viewer = User(username="viewer", role="readonly", page_permissions={"attendance_calendar": True})
            viewer.set_password("viewer123")
            db.session.add(viewer)
            db.session.flush()
            db.session.add(UserEmployeeAssignment(user_id=viewer.id, emp_id=emp.id))
            db.session.commit()
            self.emp_id = emp.id

        self.client = attach_origin(self.app.test_client())
        self._login("viewer", "viewer123")

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self, username: str, password: str):
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        return self.client.post(
            "/api/auth/login",
            json={"username": username, "password": password, "captcha_token": captcha_token},
        )

    def _get(self, query: str):
        return self.client.get(f"/api/query/attendance-calendar{query}")

    def _add_daily(self, **kwargs):
        # 员工侧视图字段取自 employee_payload（与 test_api_query.py 的构造模式一致），
        # 并从刷卡时间合成嵌套 raw_data["刷卡时间数据"]，供 _raw_punch_count 识别真实刷卡次数。
        tokens = [*(kwargs.get("check_in_times") or []), *(kwargs.get("check_out_times") or [])]
        payload = {k: v for k, v in kwargs.items() if k != "record_date"}
        payload["raw_data"] = {"刷卡时间数据": ",".join(str(t) for t in tokens)}
        with self.app.app_context():
            db.session.add(DailyRecord(emp_id=self.emp_id, employee_payload=payload, **kwargs))
            db.session.commit()

    def test_evening_overtime_threshold(self):
        """17:00 边界：16:59 非晚间，17:00 晚间。"""
        with self.app.app_context():
            db.session.add_all([
                OvertimeRecord(overtime_no="OT001", emp_id=self.emp_id,
                               start_time=datetime(2026, 7, 1, 16, 59),
                               end_time=datetime(2026, 7, 1, 18, 0), effective_hours=1.0),
                OvertimeRecord(overtime_no="OT002", emp_id=self.emp_id,
                               start_time=datetime(2026, 7, 2, 17, 0),
                               end_time=datetime(2026, 7, 2, 19, 30), effective_hours=2.5),
            ])
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        ot = {o["date"]: o for o in data["overtimes"]}
        self.assertFalse(ot["2026-07-01"]["is_evening"])
        self.assertTrue(ot["2026-07-02"]["is_evening"])
        self.assertEqual(data["summary"]["evening_overtime_hours"], 2.5)
        self.assertEqual(data["summary"]["other_overtime_hours"], 1.0)

    def test_cross_day_overtime_split(self):
        """4/1 08:00 → 4/4 17:00 共 3.4h：每天 0.85h，合计守恒。"""
        with self.app.app_context():
            db.session.add(OvertimeRecord(overtime_no="OT001", emp_id=self.emp_id,
                                          start_time=datetime(2026, 4, 1, 8, 0),
                                          end_time=datetime(2026, 4, 4, 17, 0), effective_hours=3.4))
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-04").get_json()
        ot = {o["date"]: o["hours"] for o in data["overtimes"]}
        self.assertEqual(len(ot), 4)
        self.assertTrue(all(abs(h - 0.85) < 0.001 for h in ot.values()))
        self.assertAlmostEqual(sum(ot.values()), 3.4, places=2)

    def test_same_day_overtime_merged_and_rejected_excluded(self):
        """同日同属性两条累并；已拒绝的不计入。"""
        with self.app.app_context():
            db.session.add_all([
                OvertimeRecord(overtime_no="OT001", emp_id=self.emp_id,
                               start_time=datetime(2026, 7, 3, 17, 0),
                               end_time=datetime(2026, 7, 3, 19, 0), effective_hours=1.0),
                OvertimeRecord(overtime_no="OT002", emp_id=self.emp_id,
                               start_time=datetime(2026, 7, 3, 18, 0),
                               end_time=datetime(2026, 7, 3, 20, 0), effective_hours=1.5),
                OvertimeRecord(overtime_no="OT003", emp_id=self.emp_id,
                               start_time=datetime(2026, 7, 4, 17, 0),
                               end_time=datetime(2026, 7, 4, 19, 0), effective_hours=2.0,
                               approval_status="已拒绝"),
            ])
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        ot = [o for o in data["overtimes"] if o["date"] == "2026-07-03"]
        self.assertEqual(len(ot), 1)
        self.assertAlmostEqual(ot[0]["hours"], 2.5)
        self.assertEqual(data["summary"]["evening_overtime_hours"], 2.5)

    def test_leave_split_and_summary_keeps_raw_type(self):
        """跨天请假按天拆分；出差等假种在汇总中原样保留。"""
        with self.app.app_context():
            db.session.add_all([
                LeaveRecord(leave_no="L001", emp_id=self.emp_id, leave_type="事假",
                            start_time=datetime(2026, 7, 6, 0, 0), end_time=datetime(2026, 7, 8, 0, 0),
                            duration=2.0),
                LeaveRecord(leave_no="L002", emp_id=self.emp_id, leave_type="出差",
                            start_time=datetime(2026, 7, 8, 0, 0), end_time=datetime(2026, 7, 9, 0, 0),
                            duration=1.0),
            ])
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        leaves = {(l["date"], l["leave_type"]): l["duration"] for l in data["leaves"]}
        self.assertEqual(leaves[("2026-07-06", "事假")], 1.0)
        self.assertEqual(leaves[("2026-07-07", "事假")], 1.0)
        self.assertEqual(leaves[("2026-07-08", "出差")], 1.0)
        by_type = {x["leave_type"]: x for x in data["summary"]["leave_by_type"]}
        self.assertIn("出差", by_type)
        self.assertEqual(by_type["出差"]["days"], 1.0)

    def test_leave_entries_carry_oa_fields_and_merge_in_summary(self):
        """leaves 为单据级明细（附 OA 字段）；同日同假种多单时汇总仍按天数与时长合计。"""
        with self.app.app_context():
            db.session.add_all([
                LeaveRecord(leave_no="L101", emp_id=self.emp_id, leave_type="事假",
                            start_time=datetime(2026, 7, 10, 8, 0), end_time=datetime(2026, 7, 10, 12, 0),
                            duration=0.5, reason="家中有事", approval_status="已审批"),
                LeaveRecord(leave_no="L102", emp_id=self.emp_id, leave_type="事假",
                            start_time=datetime(2026, 7, 10, 13, 0), end_time=datetime(2026, 7, 10, 17, 0),
                            duration=0.5, reason="下午外出", approval_status="已审批"),
            ])
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        day_entries = [l for l in data["leaves"] if l["date"] == "2026-07-10"]
        self.assertEqual(len(day_entries), 2)  # 每张 OA 单一条明细
        by_no = {l["leave_no"]: l for l in day_entries}
        self.assertEqual(by_no["L101"]["reason"], "家中有事")
        self.assertEqual(by_no["L101"]["approval_status"], "已审批")
        self.assertEqual(by_no["L101"]["start_time"], "2026-07-10 08:00")
        self.assertEqual(by_no["L102"]["end_time"], "2026-07-10 17:00")
        sick = [x for x in data["summary"]["leave_by_type"] if x["leave_type"] == "事假"][0]
        self.assertEqual(sick["count"], 1)      # 汇总次数 = 覆盖天数（1 天）
        self.assertAlmostEqual(sick["days"], 0.34, places=2)  # 时长 = 两单 overlap 折算合计（0.17+0.17，逐日两位舍入）

    def test_half_day_and_attendance_summary(self):
        """半勤（2 次刷卡 + 工时∈[2,5.1)）与出勤天数口径。"""
        self._add_daily(record_date=date(2026, 7, 1), check_in_times=["07:30"],
                        check_out_times=["11:30"], actual_hours=4.0)
        self._add_daily(record_date=date(2026, 7, 2), check_in_times=["07:30"],
                        check_out_times=["17:00"], actual_hours=8.0)
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        days = {d["date"]: d for d in data["days"]}
        self.assertTrue(days["2026-07-01"]["is_half_day"])
        self.assertFalse(days["2026-07-02"]["is_half_day"])
        self.assertEqual(data["summary"]["half_days"], 1)
        self.assertAlmostEqual(data["summary"]["attendance_days"], 1.5)

    def test_days_fields_serialized(self):
        """days 序列化：HH:MM 数组、punch_count、迟到、异常。"""
        self._add_daily(record_date=date(2026, 7, 3), check_in_times=["07:45", "2026-07-03 12:00"],
                        check_out_times=["16:44", "2026-07-03 19:28"], actual_hours=8.0,
                        late_minutes=15, exception_reason="忘打卡")
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        day = data["days"][0]
        self.assertEqual(day["check_in_times"], ["07:45", "12:00"])
        self.assertEqual(day["check_out_times"], ["16:44", "19:28"])
        self.assertGreaterEqual(day["punch_count"], 4)
        self.assertEqual(day["late_minutes"], 15)
        self.assertEqual(day["exception_reason"], "忘打卡")
        self.assertEqual(data["summary"]["late_minutes_total"], 15)

    def test_manager_punch_times_from_raw_data(self):
        """管理人员的结构化刷卡为空时，从 raw_data 的钉钉原始键提取上/下班时间。"""
        with self.app.app_context():
            db.session.add(DailyRecord(
                emp_id=self.emp_id,
                record_date=date(2026, 7, 3),
                check_in_times=[],
                check_out_times=[],
                actual_hours=0.0,
                raw_data={"上班1打卡时间": "08:03", "下班1打卡时间": "17:32"},
            ))
            db.session.commit()
        data = self._get(f"?emp_id={self.emp_id}&month=2026-07").get_json()
        day = data["days"][0]
        self.assertEqual(day["check_in_times"], ["08:03"])
        self.assertEqual(day["check_out_times"], ["17:32"])
        self.assertEqual(day["punch_count"], 2)

    def test_invalid_params(self):
        """缺 emp_id / 非法 month 返回 4xx。"""
        self.assertEqual(self._get("?month=2026-07").status_code, 400)
        self.assertEqual(self._get(f"?emp_id={self.emp_id}&month=bad").status_code, 400)
        self.assertEqual(self._get(f"?emp_id=99999&month=2026-07").status_code, 400)

    def test_manager_employee_allowed(self):
        """考勤日历可查询管理人员（可见范围内不再被非管理人员过滤拦截）。"""
        with self.app.app_context():
            dept = Department.query.first()
            mgr = Employee(emp_no="M001", name="经理甲", dept_id=dept.id, is_manager=True)
            db.session.add(mgr)
            db.session.flush()
            viewer = User.query.filter_by(username="viewer").first()
            db.session.add(UserEmployeeAssignment(user_id=viewer.id, emp_id=mgr.id))
            db.session.commit()
            mgr_id = mgr.id

        resp = self._get(f"?emp_id={mgr_id}&month=2026-07")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["employee"]["emp_no"], "M001")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_migrate import Migrate

from models import db
from models.user import User, UserEmployeeAssignment, UserDepartmentAssignment
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.daily_record import DailyRecord
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord
from models.leave import LeaveRecord
from models.annual_leave import AnnualLeave
from models.manager_month_stat import ManagerMonthStat
from models.manager_attendance_override import ManagerAttendanceOverride
from models.employee_shift import EmployeeShiftAssignment
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.attendance_override_history import AttendanceOverrideHistory
from models.account_set import AccountSet, AccountSetImport
from routes import configure_api_cors, register_routes

_compat_app: Flask | None = None


def _configure_error_log(app: Flask) -> None:
    """500 级未处理异常写入 logs/error.log，避免仅存在于开发终端、事后无法排查。"""
    log_dir = os.getenv("LOG_DIR", os.path.join(app.root_path, "logs"))
    os.makedirs(log_dir, exist_ok=True)
    # app.logger 按名字共享，同进程多次 create_app（如测试）时替换旧 handler，避免重复记录
    app.logger.handlers[:] = [
        handler for handler in app.logger.handlers if not getattr(handler, "_mt_emphub_error_log", False)
    ]
    handler = RotatingFileHandler(
        os.path.join(log_dir, "error.log"),
        maxBytes=1_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    handler._mt_emphub_error_log = True
    handler.setLevel(logging.ERROR)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    app.logger.addHandler(handler)


def create_app() -> Flask:
    load_dotenv()

    from config import Config

    app = Flask(__name__)
    app.config.from_object(Config)
    Config.validate()

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    os.makedirs(app.config["CALC_PROGRESS_DIR"], exist_ok=True)

    db.init_app(app)
    Migrate(app, db)
    configure_api_cors(app)
    register_routes(app)
    _configure_error_log(app)

    @app.get("/health")
    def health_check():
        return jsonify({"status": "ok"})

    return app


def _get_compat_app() -> Flask:
    global _compat_app
    if _compat_app is None:
        _compat_app = create_app()
    return _compat_app


def _resolve_debug_flag() -> bool:
    """根据 FLASK_DEBUG 环境变量决定是否开启调试模式，默认关闭。

    仅显式置为 "1" 时才开启，避免在生产环境误暴露 Werkzeug 调试器。
    """
    return os.getenv("FLASK_DEBUG") == "1"


def __getattr__(name: str):
    if name == "app":
        return _get_compat_app()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=_resolve_debug_flag())

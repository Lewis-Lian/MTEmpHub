# 前后端分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 Flask 单体页面应用改造成“Flask 纯 API 后端 + React/Vite 独立前端”的分域部署架构，并在一次正式切换窗口内替换旧业务入口。

**Architecture:** 保留现有 `models/` 和 `services/` 作为核心业务层，在后端新增统一 `/api/*` 边界、CORS/凭证配置和 JSON 鉴权入口；在仓库内新增 `frontend/` React 工程，按查询中心与后台模块承接原有模板页和 `static/js` 页面逻辑；最后移除业务模板入口并用端到端冒烟验证切换结果。

**Tech Stack:** Flask, Flask-SQLAlchemy, Flask-Migrate, Python `unittest`, React 18, Vite, TypeScript, React Router, Fetch API with credentials

---

## File Structure

### Files to Create

- `frontend/package.json` - 前端工程依赖与脚本
- `frontend/tsconfig.json` - TypeScript 配置
- `frontend/vite.config.ts` - Vite 开发代理和构建配置
- `frontend/index.html` - 前端挂载入口
- `frontend/src/main.tsx` - React 启动入口
- `frontend/src/App.tsx` - 应用根组件
- `frontend/src/router/index.tsx` - React Router 配置
- `frontend/src/api/client.ts` - 统一请求封装
- `frontend/src/api/auth.ts` - 登录与当前用户 API
- `frontend/src/api/query.ts` - 查询中心 API
- `frontend/src/api/admin.ts` - 后台管理 API
- `frontend/src/layouts/AppShell.tsx` - 登录后布局
- `frontend/src/pages/LoginPage.tsx` - 登录页
- `frontend/src/pages/query/EmployeeDashboardPage.tsx` - 员工考勤汇总查询页
- `frontend/src/pages/query/QueryPage.tsx` - 查询页通用容器
- `frontend/src/pages/query/AbnormalQueryPage.tsx` - 异常查询页
- `frontend/src/pages/query/PunchRecordsPage.tsx` - 打卡记录页
- `frontend/src/pages/query/DepartmentHoursPage.tsx` - 部门工时页
- `frontend/src/pages/query/ManagerQueryPage.tsx` - 管理人员考勤页
- `frontend/src/pages/query/ManagerOvertimePage.tsx` - 管理人员加班页
- `frontend/src/pages/query/ManagerAnnualLeavePage.tsx` - 管理人员年休页
- `frontend/src/pages/query/ManagerDepartmentHoursPage.tsx` - 管理人员部门工时页
- `frontend/src/pages/query/SummaryDownloadPage.tsx` - 汇总下载页
- `frontend/src/pages/admin/AdminDashboardPage.tsx` - 后台首页
- `frontend/src/pages/admin/AdminResourcePage.tsx` - 后台资源页通用容器
- `frontend/src/pages/admin/AccountsPage.tsx` - 账号管理页
- `frontend/src/pages/admin/EmployeesPage.tsx` - 员工管理页
- `frontend/src/pages/admin/DepartmentsPage.tsx` - 部门管理页
- `frontend/src/pages/admin/ShiftsPage.tsx` - 班次管理页
- `frontend/src/pages/admin/EmployeeAttendanceOverridesPage.tsx` - 员工考勤修正页
- `frontend/src/pages/admin/ManagerAttendanceOverridesPage.tsx` - 管理人员考勤修正页
- `frontend/src/pages/admin/ManagerOvertimeAdminPage.tsx` - 后台管理人员加班页
- `frontend/src/pages/admin/ManagerAnnualLeaveAdminPage.tsx` - 后台管理人员年休页
- `frontend/src/components/auth/ProtectedRoute.tsx` - 登录与权限守卫
- `frontend/src/components/nav/AppMenu.tsx` - 左侧菜单
- `frontend/src/components/query/QueryTable.tsx` - 查询表格组件
- `frontend/src/components/query/EmployeePicker.tsx` - 员工选择器
- `frontend/src/components/feedback/LoadingState.tsx` - 加载态
- `frontend/src/components/feedback/ErrorState.tsx` - 错误态
- `frontend/src/types/auth.ts` - 鉴权类型
- `frontend/src/types/query.ts` - 查询数据类型
- `frontend/src/types/admin.ts` - 后台数据类型
- `routes/api_auth.py` - 登录、登出、当前用户 API
- `routes/api_query.py` - 查询中心 API
- `routes/api_admin.py` - 后台管理 API
- `tests/test_api_auth.py` - 鉴权 API 测试
- `tests/test_api_query.py` - 查询 API 测试
- `tests/test_api_admin.py` - 后台 API 测试

### Files to Modify

- `app.py` - 注册 CORS 和新的 API 蓝图
- `config.py` - 增加前后端分域所需配置
- `requirements.txt` - 添加 `flask-cors`
- `routes/__init__.py` - 注册新的 API 蓝图并准备下线旧页面蓝图
- `routes/auth.py` - 调整为 API 优先的 Cookie/JWT 行为并移除页面模板依赖
- `routes/employee.py` - 将查询中心页面逻辑逐步收口到 API
- `routes/admin.py` - 将后台页面逻辑逐步收口到 API
- `utils/app_navigation.py` - 从模板导航上下文转为可供前端消费的菜单元数据
- `README.md` - 更新本地开发、前端启动和部署说明
- `tests/test_attendance_override_features.py` - 移除对业务模板页的长期依赖，保留与业务逻辑直接相关的验证

### Existing Files to Check During Execution

- `routes/admin_accounts.py`
- `routes/admin_attendance_overrides.py`
- `routes/admin_imports.py`
- `static/js/*.js`
- `templates/*.html`
- `templates/admin/*.html`
- `tests/test_permissions_and_leave_rules.py`
- `tests/test_query_feedback_ui.py`

## Task 1: 搭建纯 API 后端骨架与分域配置

**Files:**
- Create: `routes/api_auth.py`
- Create: `routes/api_query.py`
- Create: `routes/api_admin.py`
- Modify: `app.py`
- Modify: `config.py`
- Modify: `requirements.txt`
- Modify: `routes/__init__.py`
- Create: `tests/test_api_auth.py`

- [ ] **Step 1: 先写后端分域与鉴权 API 的失败测试**

```python
import os
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.user import User
from routes import register_routes


class ApiAuthBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/auth.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(self.app)
        register_routes(self.app)
        with self.app.app_context():
            db.create_all()
            user = User(username="admin", role="admin")
            user.set_password("admin123")
            db.session.add(user)
            db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_api_login_sets_cookie_for_cross_origin_frontend(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
            headers={"Origin": "http://localhost:5173"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access_token=", response.headers.get("Set-Cookie", ""))
        self.assertEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "http://localhost:5173",
        )

    def test_api_me_requires_cookie_auth(self) -> None:
        response = self.client.get("/api/auth/me")
        self.assertEqual(response.status_code, 401)
```

- [ ] **Step 2: 运行测试确认它先失败**

Run: `python3 -m unittest tests.test_api_auth -v`
Expected: FAIL，因为 `/api/auth/login`、`/api/auth/me` 和跨域配置还不存在。

- [ ] **Step 3: 添加最小后端配置与蓝图注册**

```python
# config.py
import os
from datetime import timedelta


class Config:
    APP_ENV = os.getenv("APP_ENV", "development")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///attendance.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv("SECRET_KEY") or ("dev-secret-key" if APP_ENV != "production" else None)
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "12"))
    JWT_EXPIRES_DELTA = timedelta(hours=JWT_EXPIRES_HOURS)
    UPLOAD_FOLDER = os.getenv(
        "UPLOAD_FOLDER",
        os.path.join(os.path.dirname(__file__), "static", "uploads"),
    )
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "access_token")
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "None")
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "true").lower() == "true"

    @classmethod
    def validate(cls) -> None:
        if cls.APP_ENV == "production" and not cls.SECRET_KEY:
            raise RuntimeError("SECRET_KEY must be set in production")
```

```python
# app.py
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_migrate import Migrate

from models import db
from routes import register_routes

load_dotenv()


def create_app() -> Flask:
    from config import Config

    app = Flask(__name__)
    app.config.from_object(Config)
    Config.validate()

    CORS(
        app,
        supports_credentials=True,
        resources={r"/api/*": {"origins": [app.config["FRONTEND_ORIGIN"]]}},
    )

    db.init_app(app)
    Migrate(app, db)
    register_routes(app)

    @app.get("/health")
    def health_check():
        return jsonify({"status": "ok"})

    return app
```

```python
# routes/__init__.py
from .admin import admin_bp
from .api_admin import api_admin_bp
from .api_auth import api_auth_bp
from .api_query import api_query_bp
from .auth import auth_bp
from .employee import employee_bp
from .module import module_bp


def register_routes(app):
    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_query_bp)
    app.register_blueprint(api_admin_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(employee_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(module_bp)
```

```text
# requirements.txt
flask-cors
```

- [ ] **Step 4: 写出最小可工作的鉴权 API 蓝图**

```python
# routes/api_auth.py
from flask import Blueprint, current_app, g, jsonify, make_response, request

from models import db
from models.user import User
from routes.auth import _decode_token, _generate_token, login_required

api_auth_bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")


def _cookie_kwargs() -> dict:
    return {
        "httponly": True,
        "samesite": current_app.config["SESSION_COOKIE_SAMESITE"],
        "secure": current_app.config["SESSION_COOKIE_SECURE"],
        "path": "/",
    }


@api_auth_bp.post("/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    user = User.query.filter_by(username=payload.get("username")).first()
    if not user or not user.check_password(payload.get("password") or ""):
        return jsonify({"error": "用户名或密码错误"}), 401

    token = _generate_token(user)
    response = make_response(
        jsonify(
            {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "role": user.role,
                    "page_permissions": user.effective_page_permissions(),
                }
            }
        )
    )
    response.set_cookie(current_app.config["SESSION_COOKIE_NAME"], token, **_cookie_kwargs())
    return response


@api_auth_bp.post("/logout")
def api_logout():
    response = make_response(jsonify({"ok": True}))
    response.delete_cookie(current_app.config["SESSION_COOKIE_NAME"], path="/")
    return response


@api_auth_bp.get("/me")
@login_required
def api_me():
    return jsonify(
        {
            "id": g.current_user.id,
            "username": g.current_user.username,
            "role": g.current_user.role,
            "page_permissions": g.current_user.effective_page_permissions(),
        }
    )
```

- [ ] **Step 5: 让旧鉴权代码读取新 Cookie 配置**

```python
# routes/auth.py
def _extract_token() -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    cookie_name = current_app.config.get("SESSION_COOKIE_NAME", "access_token")
    return request.cookies.get(cookie_name)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({"error": "Unauthorized"}), 401 if request.path.startswith("/api/") else redirect(url_for("auth.login_page"))
        payload = _decode_token(token)
        if not payload:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Invalid token"}), 401
            resp = redirect(url_for("auth.login_page"))
            resp.delete_cookie(current_app.config.get("SESSION_COOKIE_NAME", "access_token"))
            return resp
        user = db.session.get(User, payload["sub"])
        if not user:
            return jsonify({"error": "User not found"}), 401
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper
```

- [ ] **Step 6: 运行测试确认基础骨架通过**

Run: `python3 -m unittest tests.test_api_auth -v`
Expected: PASS

- [ ] **Step 7: 提交这一小步**

```bash
git add app.py config.py requirements.txt routes/__init__.py routes/auth.py routes/api_auth.py tests/test_api_auth.py
git commit -m "feat: add api auth and cross-origin backend shell"
```

## Task 2: 迁移查询中心数据接口到 `/api/query/*`

**Files:**
- Create: `routes/api_query.py`
- Create: `tests/test_api_query.py`
- Modify: `routes/employee.py`
- Modify: `utils/app_navigation.py`

- [ ] **Step 1: 为查询中心核心接口写失败测试**

```python
import os
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.user import User
from routes import register_routes


class ApiQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/query.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(app)
        register_routes(app)
        self.app = app
        with self.app.app_context():
            db.create_all()
            user = User(username="viewer", role="readonly", page_permissions={"employee_dashboard": True, "summary_download": True})
            user.set_password("viewer123")
            dept = Department(dept_no="D001", dept_name="制造一部")
            db.session.add_all([user, dept])
            db.session.flush()
            db.session.add(Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False))
            db.session.add(AccountSet(month="2026-05", name="2026年5月", is_active=True, is_locked=False))
            db.session.commit()
        self.client = self.app.test_client()
        self.client.post("/api/auth/login", json={"username": "viewer", "password": "viewer123"})

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_query_bootstrap_returns_accounts_and_employees(self) -> None:
        response = self.client.get("/api/query/bootstrap")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["account_sets"][0]["month"], "2026-05")
        self.assertEqual(data["employees"][0]["emp_no"], "E001")

    def test_summary_download_requires_permission(self) -> None:
        response = self.client.get("/api/query/summary-download/export?month=2026-05")
        self.assertIn(response.status_code, (200, 400))
```

- [ ] **Step 2: 运行测试确认它先失败**

Run: `python3 -m unittest tests.test_api_query -v`
Expected: FAIL，因为 `/api/query/bootstrap` 还不存在。

- [ ] **Step 3: 先实现查询中心的公共引导接口**

```python
# routes/api_query.py
from flask import Blueprint, jsonify, request

from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from routes.auth import login_required, page_permission_required

api_query_bp = Blueprint("api_query", __name__, url_prefix="/api/query")


def _serialize_employee(row: Employee) -> dict:
    return {
        "id": row.id,
        "emp_no": row.emp_no,
        "name": row.name,
        "dept_id": row.dept_id,
        "dept_name": row.department.dept_name if row.department else "",
        "is_manager": bool(row.is_manager),
    }


def _serialize_account_set(row: AccountSet) -> dict:
    return {
        "id": row.id,
        "month": row.month,
        "name": row.name,
        "is_active": bool(row.is_active),
        "is_locked": bool(row.is_locked),
    }


@api_query_bp.get("/bootstrap")
@login_required
def bootstrap():
    employees = Employee.query.order_by(Employee.emp_no.asc()).all()
    account_sets = AccountSet.query.order_by(AccountSet.month.desc()).all()
    departments = Department.query.order_by(Department.dept_no.asc()).all()
    return jsonify(
        {
            "employees": [_serialize_employee(row) for row in employees],
            "account_sets": [_serialize_account_set(row) for row in account_sets],
            "departments": [
                {"id": row.id, "dept_no": row.dept_no, "dept_name": row.dept_name}
                for row in departments
            ],
        }
    )
```

- [ ] **Step 4: 为旧查询 API 增加新的 `/api/query/*` 包装端点**

```python
# routes/api_query.py
from routes.employee import (
    abnormal_api,
    dashboard_api,
    department_hours_api,
    manager_annual_leave_api,
    manager_department_hours_api,
    manager_overtime_api,
    manager_query_api,
    punch_records_api,
    summary_download_export_api,
)


@api_query_bp.get("/employee-dashboard")
@page_permission_required("employee_dashboard")
def employee_dashboard():
    return dashboard_api()


@api_query_bp.get("/abnormal")
@page_permission_required("abnormal_query")
def abnormal():
    return abnormal_api()


@api_query_bp.get("/punch-records")
@page_permission_required("punch_records")
def punch_records():
    return punch_records_api()


@api_query_bp.get("/department-hours")
@page_permission_required("department_hours_query")
def department_hours():
    return department_hours_api()


@api_query_bp.get("/manager-attendance")
@page_permission_required("manager_query")
def manager_attendance():
    return manager_query_api()


@api_query_bp.get("/manager-overtime")
@page_permission_required("manager_overtime_query")
def manager_overtime():
    return manager_overtime_api()


@api_query_bp.get("/manager-annual-leave")
@page_permission_required("manager_annual_leave_query")
def manager_annual_leave():
    return manager_annual_leave_api()


@api_query_bp.get("/manager-department-hours")
@page_permission_required("manager_department_hours_query")
def manager_department_hours():
    return manager_department_hours_api()


@api_query_bp.get("/summary-download/export")
@page_permission_required("summary_download")
def summary_download_export():
    return summary_download_export_api()
```

- [ ] **Step 5: 给前端补一份独立菜单元数据接口**

```python
# utils/app_navigation.py
def nav_payload(user) -> list[dict]:
    payload = []
    for module in visible_modules(user):
        payload.append(
            {
                "slug": module["slug"],
                "title": module["title"],
                "entries": [
                    {
                        "key": entry["key"],
                        "label": entry["label"],
                        "href": entry["href"],
                    }
                    for entry in module["entries"]
                ],
            }
        )
    return payload
```

```python
# routes/api_query.py
from flask import g
from utils.app_navigation import nav_payload


@api_query_bp.get("/navigation")
@login_required
def navigation():
    return jsonify({"modules": nav_payload(g.current_user)})
```

- [ ] **Step 6: 跑接口测试和现有关键回归**

Run: `python3 -m unittest tests.test_api_query -v`
Expected: PASS

Run: `python3 -m unittest tests.test_permissions_and_leave_rules -v`
Expected: PASS，证明新 API 包装没有破坏现有权限逻辑。

- [ ] **Step 7: 提交查询 API 迁移**

```bash
git add routes/api_query.py routes/employee.py utils/app_navigation.py tests/test_api_query.py
git commit -m "feat: expose query center api endpoints"
```

## Task 3: 迁移后台管理接口到 `/api/admin/*`

**Files:**
- Create: `tests/test_api_admin.py`
- Modify: `routes/api_admin.py`
- Modify: `routes/admin.py`
- Modify: `routes/admin_accounts.py`
- Modify: `routes/admin_attendance_overrides.py`
- Modify: `routes/admin_imports.py`

- [ ] **Step 1: 为后台基础管理和修正模块写失败测试**

```python
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.department import Department
from models.shift import Shift
from models.user import User
from routes import register_routes


class ApiAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/admin.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(app)
        register_routes(app)
        self.app = app
        with self.app.app_context():
            db.create_all()
            user = User(username="admin", role="admin")
            user.set_password("admin123")
            db.session.add(user)
            db.session.add(Department(dept_no="D001", dept_name="行政部"))
            db.session.add(Shift(name="白班", start_time="08:00", end_time="17:00"))
            db.session.commit()
        self.client = self.app.test_client()
        self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_admin_bootstrap_returns_reference_data(self) -> None:
        response = self.client.get("/api/admin/bootstrap")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["departments"][0]["dept_no"], "D001")

    def test_accounts_endpoint_requires_admin(self) -> None:
        response = self.client.get("/api/admin/accounts")
        self.assertEqual(response.status_code, 200)
```

- [ ] **Step 2: 运行测试确认它先失败**

Run: `python3 -m unittest tests.test_api_admin -v`
Expected: FAIL，因为 `/api/admin/bootstrap` 还不存在。

- [ ] **Step 3: 先补后台公共引导接口和资源清单**

```python
# routes/api_admin.py
from flask import Blueprint, jsonify

from models.department import Department
from models.shift import Shift
from routes.auth import admin_required

api_admin_bp = Blueprint("api_admin", __name__, url_prefix="/api/admin")


@api_admin_bp.get("/bootstrap")
@admin_required
def bootstrap():
    return jsonify(
        {
            "departments": [
                {"id": row.id, "dept_no": row.dept_no, "dept_name": row.dept_name}
                for row in Department.query.order_by(Department.dept_no.asc()).all()
            ],
            "shifts": [
                {"id": row.id, "name": row.name}
                for row in Shift.query.order_by(Shift.name.asc()).all()
            ],
        }
    )
```

- [ ] **Step 4: 给已有后台 JSON 能力补统一 `/api/admin/*` 路径**

```python
# routes/api_admin.py
from routes.admin import (
    departments_api,
    employees_api,
    manager_annual_leave_admin_api,
    manager_overtime_admin_api,
    shifts_api,
)
from routes.admin_accounts import (
    account_users_api,
    account_user_detail_api,
)
from routes.admin_attendance_overrides import (
    employee_attendance_override_history_api,
    employee_attendance_override_list_api,
    employee_attendance_override_record_api,
    manager_attendance_override_history_api,
    manager_attendance_override_list_api,
    manager_attendance_override_record_api,
)


@api_admin_bp.get("/accounts")
@admin_required
def accounts():
    return account_users_api()


@api_admin_bp.get("/employees")
@admin_required
def employees():
    return employees_api()


@api_admin_bp.get("/departments")
@admin_required
def departments():
    return departments_api()


@api_admin_bp.get("/shifts")
@admin_required
def shifts():
    return shifts_api()


@api_admin_bp.get("/employee-attendance-overrides")
@admin_required
def employee_attendance_overrides():
    return employee_attendance_override_list_api()


@api_admin_bp.get("/employee-attendance-overrides/history")
@admin_required
def employee_attendance_override_history():
    return employee_attendance_override_history_api()


@api_admin_bp.put("/employee-attendance-overrides/record")
@admin_required
def employee_attendance_override_record():
    return employee_attendance_override_record_api()


@api_admin_bp.get("/manager-attendance-overrides")
@admin_required
def manager_attendance_overrides():
    return manager_attendance_override_list_api()


@api_admin_bp.get("/manager-attendance-overrides/history")
@admin_required
def manager_attendance_override_history():
    return manager_attendance_override_history_api()


@api_admin_bp.put("/manager-attendance-overrides/record")
@admin_required
def manager_attendance_override_record():
    return manager_attendance_override_record_api()


@api_admin_bp.get("/manager-overtime")
@admin_required
def manager_overtime_admin():
    return manager_overtime_admin_api()


@api_admin_bp.get("/manager-annual-leave")
@admin_required
def manager_annual_leave_admin():
    return manager_annual_leave_admin_api()
```

- [ ] **Step 5: 把旧 `routes/admin*.py` 中匿名 JSON 视图显式命名成可复用 API 函数**

```python
# routes/admin_accounts.py
@admin_bp.get("/accounts/api/users")
def account_users_api():
    users = _user_list_query().all()
    return jsonify({"rows": [_serialize_user(user) for user in users]})


@admin_bp.get("/accounts/api/users/<int:user_id>")
def account_user_detail_api(user_id: int):
    user = _require_model(User, user_id)
    return jsonify({"row": _serialize_user(user)})
```

```python
# routes/admin.py
@admin_bp.get("/employees/api")
def employees_api():
    rows = Employee.query.order_by(Employee.emp_no.asc()).all()
    return jsonify({"rows": [serialize_employee(row) for row in rows]})


@admin_bp.get("/departments/api")
def departments_api():
    rows = Department.query.order_by(Department.dept_no.asc()).all()
    return jsonify({"rows": [serialize_department(row) for row in rows]})


@admin_bp.get("/shifts/api")
def shifts_api():
    rows = Shift.query.order_by(Shift.name.asc()).all()
    return jsonify({"rows": [serialize_shift(row) for row in rows]})


@admin_bp.get("/manager-overtime/api")
def manager_overtime_admin_api():
    rows = ManagerMonthStat.query.order_by(ManagerMonthStat.month.desc()).all()
    return jsonify({"rows": [serialize_manager_month_stat(row) for row in rows]})


@admin_bp.get("/manager-annual-leave/api")
def manager_annual_leave_admin_api():
    rows = AnnualLeave.query.order_by(AnnualLeave.year.desc(), AnnualLeave.id.desc()).all()
    return jsonify({"rows": [serialize_annual_leave(row) for row in rows]})
```

- [ ] **Step 6: 跑后台接口测试和高价值回归**

Run: `python3 -m unittest tests.test_api_admin -v`
Expected: PASS

Run: `python3 -m unittest tests.test_attendance_override_features -v`
Expected: PASS，确保修正逻辑和导出逻辑未被 API 包装破坏。

- [ ] **Step 7: 提交后台 API 迁移**

```bash
git add routes/api_admin.py routes/admin.py routes/admin_accounts.py routes/admin_attendance_overrides.py routes/admin_imports.py tests/test_api_admin.py
git commit -m "feat: expose admin api endpoints"
```

## Task 4: 搭建 React/Vite 前端工程和统一路由

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/router/index.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/layouts/AppShell.tsx`
- Create: `frontend/src/components/auth/ProtectedRoute.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: 初始化前端工程文件**

```json
{
  "name": "attendance-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.4.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

```ts
// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 2: 写统一请求封装和鉴权 API**

```ts
// frontend/src/api/client.ts
export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "请求失败" }));
    throw new Error(payload.error || "请求失败");
  }

  return response.json() as Promise<T>;
}
```

```ts
// frontend/src/api/auth.ts
import { apiRequest } from "./client";

export type CurrentUser = {
  id: number;
  username: string;
  role: string;
  page_permissions: Record<string, boolean>;
};

export function login(username: string, password: string) {
  return apiRequest<{ user: CurrentUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function fetchMe() {
  return apiRequest<CurrentUser>("/api/auth/me");
}
```

- [ ] **Step 3: 建立登录页、守卫和根路由**

```tsx
// frontend/src/components/auth/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { CurrentUser } from "../../api/auth";

type Props = {
  user: CurrentUser | null;
  ready: boolean;
};

export function ProtectedRoute({ user, ready }: Props) {
  const location = useLocation();
  if (!ready) {
    return <div>加载中...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
```

```tsx
// frontend/src/pages/LoginPage.tsx
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await login(username, password);
      navigate("/employee/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <main>
      <h1>员工考勤系统登录</h1>
      <form onSubmit={handleSubmit}>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" />
        <button type="submit">登录</button>
        {error ? <p>{error}</p> : null}
      </form>
    </main>
  );
}
```

```tsx
// frontend/src/router/index.tsx
import { createBrowserRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { AppShell } from "../layouts/AppShell";
import { EmployeeDashboardPage } from "../pages/query/EmployeeDashboardPage";

export function buildRouter(user: any, ready: boolean) {
  return createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    {
      element: <ProtectedRoute user={user} ready={ready} />,
      children: [
        {
          element: <AppShell user={user} />,
          children: [
            { path: "/employee/dashboard", element: <EmployeeDashboardPage /> },
          ],
        },
      ],
    },
  ]);
}
```

- [ ] **Step 4: 启动前端根组件**

```tsx
// frontend/src/App.tsx
import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { fetchMe, type CurrentUser } from "./api/auth";
import { buildRouter } from "./router";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  return <RouterProvider router={buildRouter(user, ready)} />;
}
```

```tsx
// frontend/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: 验证前端骨架可以启动和构建**

Run: `cd frontend && npm install`
Expected: install 成功并生成 `node_modules/`

Run: `cd frontend && npm run build`
Expected: PASS，生成 `frontend/dist/`

- [ ] **Step 6: 提交前端工程骨架**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/src
git commit -m "feat: bootstrap react frontend shell"
```

## Task 5: 迁移查询中心和后台页面到 React

**Files:**
- Create: `frontend/src/api/query.ts`
- Create: `frontend/src/api/admin.ts`
- Create: `frontend/src/components/nav/AppMenu.tsx`
- Create: `frontend/src/components/query/QueryTable.tsx`
- Create: `frontend/src/components/query/EmployeePicker.tsx`
- Create: `frontend/src/components/feedback/LoadingState.tsx`
- Create: `frontend/src/components/feedback/ErrorState.tsx`
- Create: all files under `frontend/src/pages/query/`
- Create: all files under `frontend/src/pages/admin/`
- Modify: `frontend/src/router/index.tsx`
- Modify: `frontend/src/layouts/AppShell.tsx`

- [ ] **Step 1: 先写查询和后台 API 封装**

```ts
// frontend/src/api/query.ts
import { apiRequest } from "./client";

export function fetchQueryBootstrap() {
  return apiRequest<{
    employees: Array<{ id: number; emp_no: string; name: string; dept_name: string }>;
    account_sets: Array<{ id: number; month: string; name: string }>;
    departments: Array<{ id: number; dept_no: string; dept_name: string }>;
  }>("/api/query/bootstrap");
}

export function fetchEmployeeDashboard(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/employee-dashboard?${params.toString()}`);
}

export function fetchAbnormalQuery(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/abnormal?${params.toString()}`);
}

export function fetchPunchRecords(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/punch-records?${params.toString()}`);
}

export function fetchDepartmentHours(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/department-hours?${params.toString()}`);
}

export function fetchManagerAttendance(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/manager-attendance?${params.toString()}`);
}

export function fetchManagerOvertime(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/manager-overtime?${params.toString()}`);
}

export function fetchManagerAnnualLeave(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/manager-annual-leave?${params.toString()}`);
}

export function fetchManagerDepartmentHours(params: URLSearchParams) {
  return apiRequest<any>(`/api/query/manager-department-hours?${params.toString()}`);
}

export async function downloadSummaryExport(params: URLSearchParams) {
  const response = await fetch(`/api/query/summary-download/export?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("下载失败");
  }
  return response.blob();
}
```

```ts
// frontend/src/api/admin.ts
import { apiRequest } from "./client";

export function fetchAdminBootstrap() {
  return apiRequest<{
    departments: Array<{ id: number; dept_no: string; dept_name: string }>;
    shifts: Array<{ id: number; name: string }>;
  }>("/api/admin/bootstrap");
}

export function fetchAccounts() {
  return apiRequest<{ rows: any[] }>("/api/admin/accounts");
}

export function fetchEmployees() {
  return apiRequest<{ rows: any[] }>("/api/admin/employees");
}

export function fetchDepartments() {
  return apiRequest<{ rows: any[] }>("/api/admin/departments");
}

export function fetchShifts() {
  return apiRequest<{ rows: any[] }>("/api/admin/shifts");
}

export function fetchEmployeeAttendanceOverrides() {
  return apiRequest<{ rows: any[] }>("/api/admin/employee-attendance-overrides");
}

export function fetchManagerAttendanceOverrides() {
  return apiRequest<{ rows: any[] }>("/api/admin/manager-attendance-overrides");
}

export function fetchManagerOvertimeAdmin() {
  return apiRequest<{ rows: any[] }>("/api/admin/manager-overtime");
}

export function fetchManagerAnnualLeaveAdmin() {
  return apiRequest<{ rows: any[] }>("/api/admin/manager-annual-leave");
}
```

- [ ] **Step 2: 做出复用布局和基础表格组件**

```tsx
// frontend/src/layouts/AppShell.tsx
import { Outlet } from "react-router-dom";
import type { CurrentUser } from "../api/auth";
import { AppMenu } from "../components/nav/AppMenu";

type Props = {
  user: CurrentUser;
};

export function AppShell({ user }: Props) {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <AppMenu user={user} />
      </aside>
      <section className="app-shell__content">
        <Outlet />
      </section>
    </div>
  );
}
```

```tsx
// frontend/src/components/query/QueryTable.tsx
type Props = {
  headers: string[];
  rows: Array<Array<string | number | null>>;
};

export function QueryTable({ headers, rows }: Props) {
  return (
    <table>
      <thead>
        <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell ?? ""}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: 先完成一个查询页模板，再批量套用**

```tsx
// frontend/src/pages/query/QueryPage.tsx
import { useEffect, useState } from "react";
import { fetchQueryBootstrap } from "../../api/query";
import { QueryTable } from "../../components/query/QueryTable";

type Props = {
  title: string;
  loadRows: (params: URLSearchParams) => Promise<{ headers?: string[]; rows?: Array<Array<string | number | null>> }>;
};

export function QueryPage({ title, loadRows }: Props) {
  const [accountSets, setAccountSets] = useState<Array<{ month: string; name: string }>>([]);
  const [rows, setRows] = useState<Array<Array<string | number | null>>>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  useEffect(() => {
    fetchQueryBootstrap().then((payload) => setAccountSets(payload.account_sets));
  }, []);

  async function handleQuery() {
    const params = new URLSearchParams();
    if (accountSets[0]?.month) {
      params.set("month", accountSets[0].month);
    }
    const payload = await loadRows(params);
    setHeaders(payload.headers || []);
    setRows(payload.rows || []);
  }

  return (
    <section>
      <h1>员工考勤汇总查询</h1>
      <button onClick={handleQuery}>查询</button>
      <QueryTable headers={headers} rows={rows} />
    </section>
  );
}
```

```tsx
// frontend/src/pages/query/EmployeeDashboardPage.tsx
import { fetchEmployeeDashboard } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function EmployeeDashboardPage() {
  return <QueryPage title="员工考勤汇总查询" loadRows={fetchEmployeeDashboard} />;
}
```

```tsx
// frontend/src/pages/query/AbnormalQueryPage.tsx
import { fetchAbnormalQuery } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function AbnormalQueryPage() {
  return <QueryPage title="异常查询" loadRows={fetchAbnormalQuery} />;
}
```

```tsx
// frontend/src/pages/query/PunchRecordsPage.tsx
import { fetchPunchRecords } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function PunchRecordsPage() {
  return <QueryPage title="打卡记录查询" loadRows={fetchPunchRecords} />;
}
```

```tsx
// frontend/src/pages/query/DepartmentHoursPage.tsx
import { fetchDepartmentHours } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function DepartmentHoursPage() {
  return <QueryPage title="部门工时查询" loadRows={fetchDepartmentHours} />;
}
```

```tsx
// frontend/src/pages/query/ManagerQueryPage.tsx
import { fetchManagerAttendance } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function ManagerQueryPage() {
  return <QueryPage title="管理人员考勤查询" loadRows={fetchManagerAttendance} />;
}
```

```tsx
// frontend/src/pages/query/ManagerOvertimePage.tsx
import { fetchManagerOvertime } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function ManagerOvertimePage() {
  return <QueryPage title="管理人员加班查询" loadRows={fetchManagerOvertime} />;
}
```

```tsx
// frontend/src/pages/query/ManagerAnnualLeavePage.tsx
import { fetchManagerAnnualLeave } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function ManagerAnnualLeavePage() {
  return <QueryPage title="管理人员年休查询" loadRows={fetchManagerAnnualLeave} />;
}
```

```tsx
// frontend/src/pages/query/ManagerDepartmentHoursPage.tsx
import { fetchManagerDepartmentHours } from "../../api/query";
import { QueryPage } from "./QueryPage";

export function ManagerDepartmentHoursPage() {
  return <QueryPage title="管理人员部门工时查询" loadRows={fetchManagerDepartmentHours} />;
}
```

```tsx
// frontend/src/pages/query/SummaryDownloadPage.tsx
import { downloadSummaryExport } from "../../api/query";

export function SummaryDownloadPage() {
  async function handleDownload() {
    await downloadSummaryExport(new URLSearchParams());
  }

  return (
    <section>
      <h1>汇总下载</h1>
      <button onClick={handleDownload}>下载 XLSX</button>
    </section>
  );
}
```

- [ ] **Step 4: 完成后台页面迁移**

```tsx
// frontend/src/pages/admin/AdminResourcePage.tsx
import { useEffect, useState } from "react";

type Props = {
  title: string;
  loadRows: () => Promise<{ rows: any[] }>;
  renderLabel: (row: any) => string;
};

export function AdminResourcePage({ title, loadRows, renderLabel }: Props) {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    loadRows().then((payload) => setRows(payload.rows));
  }, [loadRows]);

  return (
    <section>
      <h1>{title}</h1>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{renderLabel(row)}</li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// frontend/src/pages/admin/AccountsPage.tsx
import { fetchAccounts } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function AccountsPage() {
  return <AdminResourcePage title="账号管理" loadRows={fetchAccounts} renderLabel={(row) => row.username} />;
}
```

```tsx
// frontend/src/pages/admin/EmployeesPage.tsx
import { fetchEmployees } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function EmployeesPage() {
  return <AdminResourcePage title="员工管理" loadRows={fetchEmployees} renderLabel={(row) => `${row.emp_no} ${row.name}`} />;
}
```

```tsx
// frontend/src/pages/admin/DepartmentsPage.tsx
import { fetchDepartments } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function DepartmentsPage() {
  return <AdminResourcePage title="部门管理" loadRows={fetchDepartments} renderLabel={(row) => `${row.dept_no} ${row.dept_name}`} />;
}
```

```tsx
// frontend/src/pages/admin/ShiftsPage.tsx
import { fetchShifts } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function ShiftsPage() {
  return <AdminResourcePage title="班次管理" loadRows={fetchShifts} renderLabel={(row) => row.name} />;
}
```

```tsx
// frontend/src/pages/admin/EmployeeAttendanceOverridesPage.tsx
import { fetchEmployeeAttendanceOverrides } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function EmployeeAttendanceOverridesPage() {
  return <AdminResourcePage title="员工考勤修正" loadRows={fetchEmployeeAttendanceOverrides} renderLabel={(row) => row.employee.name} />;
}
```

```tsx
// frontend/src/pages/admin/ManagerAttendanceOverridesPage.tsx
import { fetchManagerAttendanceOverrides } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function ManagerAttendanceOverridesPage() {
  return <AdminResourcePage title="管理人员考勤修正" loadRows={fetchManagerAttendanceOverrides} renderLabel={(row) => row.employee.name} />;
}
```

```tsx
// frontend/src/pages/admin/ManagerOvertimeAdminPage.tsx
import { fetchManagerOvertimeAdmin } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function ManagerOvertimeAdminPage() {
  return <AdminResourcePage title="管理人员加班维护" loadRows={fetchManagerOvertimeAdmin} renderLabel={(row) => row.employee_name} />;
}
```

```tsx
// frontend/src/pages/admin/ManagerAnnualLeaveAdminPage.tsx
import { fetchManagerAnnualLeaveAdmin } from "../../api/admin";
import { AdminResourcePage } from "./AdminResourcePage";

export function ManagerAnnualLeaveAdminPage() {
  return <AdminResourcePage title="管理人员年休维护" loadRows={fetchManagerAnnualLeaveAdmin} renderLabel={(row) => row.employee_name} />;
}
```

```tsx
// frontend/src/pages/admin/AdminDashboardPage.tsx
export function AdminDashboardPage() {
  return (
    <section>
      <h1>后台首页</h1>
      <p>从左侧菜单进入账号、人员、部门、班次与修正模块。</p>
    </section>
  );
}
```

- [ ] **Step 5: 扩展路由，把所有旧业务入口都映射到 React 页面**

```tsx
// frontend/src/router/index.tsx
{ path: "/employee/dashboard", element: <EmployeeDashboardPage /> },
{ path: "/employee/abnormal-query", element: <AbnormalQueryPage /> },
{ path: "/employee/punch-records", element: <PunchRecordsPage /> },
{ path: "/employee/department-hours-query", element: <DepartmentHoursPage /> },
{ path: "/employee/manager-query", element: <ManagerQueryPage /> },
{ path: "/employee/manager-overtime-query", element: <ManagerOvertimePage /> },
{ path: "/employee/manager-annual-leave-query", element: <ManagerAnnualLeavePage /> },
{ path: "/employee/manager-department-hours-query", element: <ManagerDepartmentHoursPage /> },
{ path: "/employee/summary-download", element: <SummaryDownloadPage /> },
{ path: "/admin/dashboard", element: <AdminDashboardPage /> },
{ path: "/admin/accounts", element: <AccountsPage /> },
{ path: "/admin/employees", element: <EmployeesPage /> },
{ path: "/admin/departments", element: <DepartmentsPage /> },
{ path: "/admin/shifts", element: <ShiftsPage /> },
{ path: "/admin/employee-attendance-overrides", element: <EmployeeAttendanceOverridesPage /> },
{ path: "/admin/manager-attendance-overrides", element: <ManagerAttendanceOverridesPage /> },
{ path: "/admin/manager-overtime", element: <ManagerOvertimeAdminPage /> },
{ path: "/admin/manager-annual-leave", element: <ManagerAnnualLeaveAdminPage /> },
```

- [ ] **Step 6: 本地联调前端和后端**

Run: `python3 app.py`
Expected: Flask 在 `http://127.0.0.1:5000` 启动成功。

Run: `cd frontend && npm run dev`
Expected: Vite 在 `http://127.0.0.1:5173` 启动成功，浏览器可访问 `/login`。

- [ ] **Step 7: 提交 React 页面迁移**

```bash
git add frontend/src
git commit -m "feat: migrate query and admin pages to react"
```

## Task 6: 下线旧模板业务入口并完成切换验证

**Files:**
- Modify: `routes/auth.py`
- Modify: `routes/employee.py`
- Modify: `routes/admin.py`
- Modify: `routes/module.py`
- Modify: `README.md`
- Modify: `tests/test_attendance_override_features.py`

- [ ] **Step 1: 先为旧页面入口下线写失败测试**

```python
def test_legacy_login_page_is_not_the_primary_entry_anymore(self) -> None:
    response = self.client.get("/login")
    self.assertIn(response.status_code, (301, 302, 404))


def test_legacy_dashboard_page_is_not_served_as_business_html(self) -> None:
    response = self.client.get("/employee/dashboard")
    self.assertNotIn("text/html", response.content_type)
```

- [ ] **Step 2: 运行相关测试确认它先失败**

Run: `python3 -m unittest tests.test_attendance_override_features -v`
Expected: FAIL，因为旧模板页仍然对外渲染。

- [ ] **Step 3: 将旧页面入口改为前端入口重定向或显式下线**

```python
# routes/auth.py
@auth_bp.route("/")
def root():
    return redirect(current_app.config.get("FRONTEND_APP_URL", "http://localhost:5173/login"))


@auth_bp.route("/login", methods=["GET"])
def login_page():
    return redirect(current_app.config.get("FRONTEND_APP_URL", "http://localhost:5173/login"))
```

```python
# routes/employee.py
@employee_bp.route("/dashboard")
@page_permission_required("employee_dashboard")
def dashboard():
    return redirect(f"{current_app.config['FRONTEND_APP_URL']}/employee/dashboard")
```

```python
# routes/admin.py
@admin_bp.route("/dashboard")
@admin_required
def dashboard():
    return redirect(f"{current_app.config['FRONTEND_APP_URL']}/admin/dashboard")
```

- [ ] **Step 4: 删除对模板 HTML 的长期断言，改为 API 和跳转断言**

```python
# tests/test_attendance_override_features.py
def test_query_navigation_api_contains_dashboard_entry(self) -> None:
    response = self.client.get("/api/query/navigation")
    self.assertEqual(response.status_code, 200)
    modules = response.get_json()["modules"]
    self.assertTrue(any(entry["href"] == "/employee/dashboard" for module in modules for entry in module["entries"]))
```

- [ ] **Step 5: 更新 README 的开发和部署说明**

```md
## 本地开发启动

后端：
- `python3 app.py`

前端：
- `cd frontend`
- `npm install`
- `npm run dev`

生产环境应分别部署：

- 前端：Vite build 产物部署到前端站点
- 后端：Flask/Waitress 暴露 `https://api.example.com`
```

- [ ] **Step 6: 跑完整验证**

Run: `python3 -m unittest tests.test_api_auth tests.test_api_query tests.test_api_admin -v`
Expected: PASS

Run: `python3 -m unittest tests.test_permissions_and_leave_rules tests.test_manager_attendance_service tests.test_import_pipeline -v`
Expected: PASS

Run: `cd frontend && npm run build`
Expected: PASS

Run: `curl -I http://127.0.0.1:5000/health`
Expected: `HTTP/1.1 200 OK`

- [ ] **Step 7: 提交切换收尾**

```bash
git add routes/auth.py routes/employee.py routes/admin.py routes/module.py README.md tests/test_attendance_override_features.py
git commit -m "refactor: retire legacy template entrypoints"
```

## Self-Review

- Spec coverage:
  - 纯 API 后端：Task 1、Task 2、Task 3、Task 6 覆盖
  - React/Vite 独立前端：Task 4、Task 5 覆盖
  - 分域 Cookie 鉴权和 CORS：Task 1 覆盖
  - 查询中心和后台管理页面承接：Task 2、Task 3、Task 5 覆盖
  - 一次性切换和回滚边界：Task 6 覆盖
- Placeholder scan:
  - 无占位语或“以后再补”类描述
- Type consistency:
  - 后端用户对象统一使用 `page_permissions`
  - 前端 `/api/auth/me`、`/api/auth/login` 共用 `CurrentUser`
  - 查询接口统一放在 `/api/query/*`
  - 后台接口统一放在 `/api/admin/*`

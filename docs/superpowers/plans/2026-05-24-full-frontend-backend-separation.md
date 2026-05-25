# 彻底前后端分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Flask 后端只保留 `/api/auth/*`、`/api/query/*`、`/api/admin/*` 和 `/health`，彻底下线所有历史页面路由与旧接口入口。

**Architecture:** 先用测试把“旧入口必须消失、纯 API 仍可工作”固定下来，再把 API 所需的鉴权辅助逻辑从 `routes/auth.py` 中抽离，最后停止注册旧蓝图并删除仍指向旧契约的测试与说明。旧业务实现函数可以继续被新 API 蓝图复用，但旧蓝图本身不再对外暴露任何 URL。

**Tech Stack:** Flask、Flask-CORS、SQLAlchemy、PyJWT、pytest、React、Vite

---

### Task 1: 锁定纯 API 契约与旧入口下线目标

**Files:**
- Modify: `tests/test_api_auth.py`
- Modify: `tests/test_api_query.py`
- Modify: `tests/test_api_admin.py`
- Create: `tests/test_route_separation.py`

- [ ] **Step 1: 在 API 鉴权测试中写出旧鉴权入口必须失效的失败用例**

```python
def test_legacy_auth_routes_are_not_registered(self):
    for path in ["/", "/login", "/logout", "/change-password", "/api/me"]:
        response = self.client.get(path)
        self.assertEqual(response.status_code, 404, path)
```

- [ ] **Step 2: 运行单测确认它先失败**

Run: `python3 -m pytest -q tests/test_api_auth.py -k legacy_auth_routes_are_not_registered`

Expected: FAIL，因为当前 `auth_bp` 仍注册了这些旧路由，至少会返回 `200`、`302` 或 `401`。

- [ ] **Step 3: 在查询与后台 API 测试中写出旧业务入口必须失效的失败用例**

```python
def test_legacy_query_routes_are_not_registered(self):
    for path in [
        "/employee/home",
        "/employee/dashboard",
        "/employee/api/account-sets",
        "/employee/api/final-data",
        "/module/query",
    ]:
        response = self.client.get(path)
        self.assertEqual(response.status_code, 404, path)

def test_legacy_admin_routes_are_not_registered(self):
    for path in [
        "/admin/dashboard",
        "/admin/accounts",
        "/admin/employees",
        "/admin/shifts",
        "/admin/employee-attendance-overrides",
    ]:
        response = self.client.get(path)
        self.assertEqual(response.status_code, 404, path)
```

- [ ] **Step 4: 运行这些测试确认它们先失败**

Run: `python3 -m pytest -q tests/test_api_query.py tests/test_api_admin.py -k legacy`

Expected: FAIL，因为 `employee_bp`、`admin_bp`、`module_bp` 仍注册并对外暴露这些路径。

- [ ] **Step 5: 新建一个聚合测试文件，覆盖正式 API 仍存在**

```python
class TestRouteSeparation(unittest.TestCase):
    def test_only_new_api_spaces_remain(self):
        rules = {rule.rule for rule in self.app.url_map.iter_rules()}
        self.assertIn("/health", rules)
        self.assertIn("/api/auth/login", rules)
        self.assertIn("/api/auth/logout", rules)
        self.assertIn("/api/auth/me", rules)
        self.assertIn("/api/query/bootstrap", rules)
        self.assertIn("/api/admin/bootstrap", rules)
        self.assertNotIn("/login", rules)
        self.assertNotIn("/employee/dashboard", rules)
        self.assertNotIn("/admin/dashboard", rules)
        self.assertNotIn("/module/<slug>", rules)
```

- [ ] **Step 6: 运行新测试确认它也先失败**

Run: `python3 -m pytest -q tests/test_route_separation.py`

Expected: FAIL，因为当前路由表里仍然包含旧入口。

- [ ] **Step 7: 提交测试基线**

```bash
git add tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py tests/test_route_separation.py
git commit -m "test: define pure api separation contract"
```

### Task 2: 抽离 API 鉴权辅助逻辑，切断对页面蓝图模块的硬依赖

**Files:**
- Create: `routes/auth_helpers.py`
- Modify: `routes/api_auth.py`
- Modify: `routes/api_query.py`
- Modify: `routes/api_admin.py`
- Modify: `routes/auth.py`

- [ ] **Step 1: 先在新模块中写一个最小失败导入测试**

```python
from routes.auth_helpers import admin_required, login_required, page_permission_required

def test_auth_helpers_module_exports_api_guards():
    assert callable(login_required)
    assert callable(admin_required)
    assert callable(page_permission_required)
```

- [ ] **Step 2: 运行该测试确认先失败**

Run: `python3 -m pytest -q tests/test_route_separation.py -k auth_helpers_module_exports_api_guards`

Expected: FAIL，提示 `routes.auth_helpers` 不存在。

- [ ] **Step 3: 在 `routes/auth_helpers.py` 中写最小实现，搬运纯 API 所需辅助逻辑**

```python
from __future__ import annotations

from datetime import datetime, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from models import db
from models.user import User

_REMEMBER_ME_SECONDS = 30 * 24 * 60 * 60

def session_cookie_kwargs(*, remember_me: bool = False) -> dict:
    cookie_kwargs = {
        "httponly": True,
        "samesite": current_app.config["SESSION_COOKIE_SAMESITE"],
        "secure": current_app.config["SESSION_COOKIE_SECURE"],
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = _REMEMBER_ME_SECONDS
    return cookie_kwargs

def generate_token(user: User) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + current_app.config["JWT_EXPIRES_DELTA"]).timestamp()),
    }
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")

def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None

def extract_token() -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return request.cookies.get(current_app.config.get("SESSION_COOKIE_NAME", "access_token"))

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = extract_token()
        if not token:
            return jsonify({"error": "Unauthorized"}), 401

        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "Invalid token"}), 401

        user = db.session.get(User, payload["sub"])
        if not user:
            return jsonify({"error": "User not found"}), 401

        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper

def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if g.current_user.role != "admin":
            return jsonify({"error": "Forbidden"}), 403
        return fn(*args, **kwargs)

    return wrapper

def page_permission_required(page_key: str):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if g.current_user.role == "admin" or g.current_user.can_access_page(page_key):
                return fn(*args, **kwargs)
            return jsonify({"error": "Forbidden"}), 403

        return wrapper

    return decorator
```

- [ ] **Step 4: 改新 API 蓝图导入路径，只依赖新辅助模块**

```python
from routes.auth_helpers import generate_token, login_required, session_cookie_kwargs
```

```python
from routes.auth_helpers import login_required, page_permission_required
```

```python
from routes.auth_helpers import admin_required
```

- [ ] **Step 5: 让旧 `routes/auth.py` 只保留仍需要的页面逻辑，或在下一任务前彻底不再被 API 引用**

```python
from routes.auth_helpers import (
    admin_required,
    decode_token,
    extract_token,
    generate_token,
    login_required,
    page_permission_required,
    session_cookie_kwargs,
)
```

- [ ] **Step 6: 运行相关 API 测试确认新辅助模块工作正常**

Run: `python3 -m pytest -q tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py`

Expected: PASS，且失败信息里不再出现 API 蓝图对 `routes.auth` 页面路由的直接依赖问题。

- [ ] **Step 7: 提交鉴权解耦改动**

```bash
git add routes/auth_helpers.py routes/api_auth.py routes/api_query.py routes/api_admin.py routes/auth.py
git commit -m "refactor: extract api auth helpers"
```

### Task 3: 停止注册旧蓝图并删除历史入口

**Files:**
- Modify: `routes/__init__.py`
- Modify: `routes/auth.py`
- Optionally Modify: `app.py`

- [ ] **Step 1: 写出最小实现，只注册新 API 蓝图**

```python
from .api_admin import api_admin_bp
from .api_auth import api_auth_bp
from .api_query import api_query_bp

def register_routes(app):
    configure_api_cors(app)
    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_query_bp)
    app.register_blueprint(api_admin_bp)
```

- [ ] **Step 2: 删除旧蓝图导入与页面上下文注入**

```python
from .auth import auth_bp
from .employee import employee_bp
from .admin import admin_bp
from .module import module_bp
from utils.app_navigation import nav_context
```

改成只保留 API 蓝图导入，不再定义：

```python
@app.context_processor
def inject_app_navigation():
    ...
```

- [ ] **Step 3: 运行旧入口下线测试，确认路由表已经收口**

Run: `python3 -m pytest -q tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py tests/test_route_separation.py -k "legacy or only_new_api_spaces_remain"`

Expected: PASS，所有旧入口都应返回 `404`，路由表中只剩新 API 和 `/health`。

- [ ] **Step 4: 删除已不再需要的旧页面辅助逻辑和历史路由**

```python
auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/")
def root():
    ...

@auth_bp.route("/login", methods=["GET"])
def login_page():
    ...
```

处理方式：
- 若该文件已完全无用，删除整个 `routes/auth.py`
- 若仍有别的测试或模块需要其中个别非路由辅助内容，则只保留最小必要内容，确保文件中不再定义任何旧路由

- [ ] **Step 5: 重新运行聚合后端测试**

Run: `python3 -m pytest -q tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py tests/test_route_separation.py`

Expected: PASS

- [ ] **Step 6: 提交路由收口改动**

```bash
git add routes/__init__.py routes/auth.py app.py tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py tests/test_route_separation.py
git commit -m "refactor: remove legacy frontend routes"
```

### Task 4: 清理仍依赖旧入口的测试与文档，完成验证

**Files:**
- Modify: `tests/test_attendance_override_features.py`
- Modify: `tests/test_query_feedback_ui.py`
- Modify: `tests/test_app_tabs_e2e.py`
- Modify: `tests/test_api_admin.py`
- Modify: `README.md`

- [ ] **Step 1: 删除或改写把旧入口当成正确行为的测试断言**

```python
self.assertEqual(response.headers["Location"], "http://localhost:5173/login")
self.assertEqual(home_res.headers["Location"], "http://localhost:5173/employee/home")
self.assertEqual(account_res.headers["Location"], "http://localhost:5173/admin/dashboard")
```

改成两类处理：
- 纯页面重定向测试：直接删除
- 同能力已被新 API 覆盖的测试：改为断言 `/api/*` 返回正确 JSON、权限码或文件下载

- [ ] **Step 2: 清理仍通过旧入口登录或取数的辅助代码**

```python
self.client.post("/login", data={"username": "admin", "password": "admin123"})
page.goto(f"{self.base_url}/login", wait_until="networkidle")
page.route("**/employee/api/final-data?*", delayed_final_data)
```

改成：

```python
self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
page.goto(f"{frontend_base_url}/login", wait_until="networkidle")
page.route("**/api/query/employee-dashboard?*", delayed_final_data)
```

如果现有 E2E 基础设施严重依赖 Flask 页面入口，且短期无法以独立前端替代，则删除这些 E2E，并在本次变更说明中明确原因。

- [ ] **Step 3: 清理 `tests/test_api_admin.py` 中“新旧接口结果应一致”的对比断言**

```python
self.client.get("/api/admin/accounts").get_json(),
self.client.get("/admin/users").get_json(),
```

改成只断言新 API 结果结构：

```python
payload = self.client.get("/api/admin/accounts").get_json()
self.assertIsInstance(payload, list)
self.assertEqual(payload[0]["username"], "admin")
```

- [ ] **Step 4: 更新 README，明确后端不再提供页面入口**

```markdown
## 前后端分离说明

- 浏览器业务入口只由 `frontend/` 独立前端提供
- Flask 只提供 `/api/auth/*`、`/api/query/*`、`/api/admin/*` 与 `/health`
- 后端不再提供 `/login`、`/employee/*`、`/admin/*`、`/module/*` 页面或兼容跳转
```

- [ ] **Step 5: 运行最终验证**

Run: `python3 -m pytest -q tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py tests/test_route_separation.py`

Expected: PASS

Run: `cd frontend && npm run build`

Expected: `vite` 构建成功，输出 `dist/index.html` 和对应静态资源。

- [ ] **Step 6: 提交收尾改动**

```bash
git add tests/test_attendance_override_features.py tests/test_query_feedback_ui.py tests/test_app_tabs_e2e.py tests/test_api_admin.py README.md
git commit -m "test: align docs and tests with pure api backend"
```

## 自检

- 规格覆盖：计划已覆盖旧入口下线、鉴权辅助抽离、蓝图停注册、测试清理、README 更新和前端构建验证。
- 占位符扫描：未使用 `TODO`、`TBD` 或“后续处理”式占位描述。
- 类型一致性：新辅助模块统一使用 `generate_token`、`session_cookie_kwargs`、`extract_token`、`login_required`、`admin_required`、`page_permission_required` 这组名称，后续任务沿用同一命名。

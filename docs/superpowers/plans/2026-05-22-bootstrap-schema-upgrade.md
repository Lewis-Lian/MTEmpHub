# Bootstrap Schema Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用启动不再隐式执行数据库结构升级，同时保留显式的初始化和旧库兼容升级入口。

**Architecture:** 从 `app.py` 中移除启动期 `initialize_database()` 调用，把 schema 初始化职责收敛到 CLI 命令。保留 `init-db` 负责新库初始化，并新增 `upgrade-legacy-schema` 负责旧库兼容升级。测试围绕“启动不改库、命令负责升级”两条边界展开。

**Tech Stack:** Flask、Flask-SQLAlchemy、Flask CLI、Python `unittest`

---

### Task 1: 收敛启动路径

**Files:**
- Modify: `app.py`
- Test: `tests/test_app_bootstrap.py`

- [ ] **Step 1: 写启动期不再隐式建表的失败测试**

```python
def test_create_app_does_not_run_db_create_all_implicitly(self) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "test",
                "DATABASE_URL": f"sqlite:///{os.path.join(tmpdir, 'no-init.db')}",
                "SECRET_KEY": "test-secret",
                "UPLOAD_FOLDER": os.path.join(tmpdir, "uploads"),
            },
            clear=False,
        ):
            app_module = self._load_app_module()
            with mock.patch.object(db, "create_all") as create_all:
                app_module.create_app()
            self.assertEqual(create_all.call_count, 0)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py -k does_not_run_db_create_all_implicitly`
Expected: FAIL，因为当前 `create_app()` 会触发初始化。

- [ ] **Step 3: 修改 `app.py` 去掉启动期初始化**

```python
def create_app() -> Flask:
    load_dotenv()

    from config import Config

    app = Flask(__name__)
    app.config.from_object(Config)
    Config.validate()

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    db.init_app(app)
    Migrate(app, db)
    register_routes(app)

    @app.get("/health")
    def health_check():
        return jsonify({"status": "ok"})

    return app
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py -k does_not_run_db_create_all_implicitly`
Expected: PASS

### Task 2: 增加显式旧库升级命令

**Files:**
- Modify: `manage.py`
- Test: `tests/test_app_bootstrap.py`

- [ ] **Step 1: 写 CLI 命令回归测试**

```python
def test_upgrade_legacy_schema_command_runs_schema_compatibility_explicitly(self) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "test",
                "DATABASE_URL": f"sqlite:///{os.path.join(tmpdir, 'legacy-upgrade.db')}",
                "SECRET_KEY": "test-secret",
                "UPLOAD_FOLDER": os.path.join(tmpdir, "uploads"),
            },
            clear=False,
        ):
            manage_module = self._load_manage_module()
            with mock.patch.object(manage_module, "ensure_schema_compatibility") as upgrade:
                result = manage_module.app.test_cli_runner().invoke(args=["upgrade-legacy-schema"])

            self.assertEqual(result.exit_code, 0, result.output)
            upgrade.assert_called_once_with()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py -k upgrade_legacy_schema_command`
Expected: FAIL，因为命令尚不存在。

- [ ] **Step 3: 修改 `manage.py` 增加命令**

```python
from services.bootstrap_service import ensure_default_admin, ensure_schema_compatibility, initialize_database


@app.cli.command("upgrade-legacy-schema")
def upgrade_legacy_schema_command() -> None:
    with app.app_context():
        ensure_schema_compatibility()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py -k upgrade_legacy_schema_command`
Expected: PASS

### Task 3: 守住初始化命令职责

**Files:**
- Modify: `tests/test_app_bootstrap.py`
- Modify: `README.md`

- [ ] **Step 1: 写 `init-db` 仍调用初始化服务的测试**

```python
def test_init_db_command_runs_initialize_database_explicitly(self) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "test",
                "DATABASE_URL": f"sqlite:///{os.path.join(tmpdir, 'init-db.db')}",
                "SECRET_KEY": "test-secret",
                "UPLOAD_FOLDER": os.path.join(tmpdir, "uploads"),
            },
            clear=False,
        ):
            manage_module = self._load_manage_module()
            with mock.patch.object(manage_module, "initialize_database") as initialize_database:
                result = manage_module.app.test_cli_runner().invoke(args=["init-db"])

            self.assertEqual(result.exit_code, 0, result.output)
            initialize_database.assert_called_once_with()
```

- [ ] **Step 2: 运行测试确认行为稳定**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py -k init_db_command_runs_initialize_database_explicitly`
Expected: PASS

- [ ] **Step 3: 更新 README**

```text
- 本地/新环境初始化继续使用 `flask --app manage.py init-db`
- 已有旧数据库升级字段时，显式运行 `flask --app manage.py upgrade-legacy-schema`
- 应用启动本身不再执行隐式 schema 升级
```

- [ ] **Step 4: 运行启动相关测试**

Run: `python3 -m pytest -q tests/test_app_bootstrap.py`
Expected: PASS

### Task 4: 全量验证

**Files:**
- Modify: `docs/superpowers/specs/2026-05-22-bootstrap-schema-upgrade-design.md`
- Modify: `docs/superpowers/plans/2026-05-22-bootstrap-schema-upgrade.md`

- [ ] **Step 1: 运行全量测试**

Run: `python3 -m pytest -q`
Expected: `0 failed`

- [ ] **Step 2: 自查文档与实现是否一致**

```text
检查点：
1. `app.py` 中不再调用 `initialize_database()`
2. `manage.py` 中存在 `init-db` 和 `upgrade-legacy-schema`
3. README 已说明新旧库两条路径
4. 测试覆盖启动期与命令期职责边界
```

- [ ] **Step 3: 提交**

```bash
git add app.py manage.py README.md tests/test_app_bootstrap.py docs/superpowers/specs/2026-05-22-bootstrap-schema-upgrade-design.md docs/superpowers/plans/2026-05-22-bootstrap-schema-upgrade.md
git commit -m "refactor: make schema upgrades explicit"
```

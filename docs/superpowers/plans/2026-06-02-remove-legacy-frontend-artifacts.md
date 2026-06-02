# Remove Legacy Frontend Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove legacy Flask-rendered UI artifacts after frontend/backend separation while preserving `/api/auth/*`, `/api/query/*`, `/api/admin/*`, `/health`, CLI bootstrap behavior, and current React frontend behavior.

**Architecture:** First prove which legacy files are still referenced, then move reusable business logic out of legacy page modules into API/service modules, and only then delete page routes, templates, static legacy assets, backup files, and generated build artifacts. Each deletion batch has a regression test or an explicit command that proves the removed files are no longer needed.

**Tech Stack:** Flask, SQLAlchemy, pytest/unittest, React, TypeScript, Vite, Vitest.

---

## Assumptions And Boundaries

- The React frontend under `frontend/src/` is the supported UI.
- The Flask app should expose only `/health`, `/api/auth/*`, `/api/query/*`, and `/api/admin/*`.
- Legacy page URLs such as `/login`, `/employee/*`, `/admin/*`, `/module/*`, and legacy JSON URLs such as `/employee/api/*` should remain unavailable.
- `templates/export_templates/manager_attendance.xlsx` is legacy only after the manager attendance export-template API is moved away from `routes/employee.py`.
- Database compatibility helpers named `legacy` are not UI artifacts. Keep `manage.py upgrade-legacy-schema`, `services/bootstrap_service.py`, and legacy schema tests unless the user explicitly asks to drop old database upgrade support.
- Do not delete `frontend/src/styles/legacy-ui.css` in this cleanup unless a separate styling migration replaces its current import from `frontend/src/main.tsx`.

## Files To Modify Or Delete

- Modify: `routes/api_query.py`
  - Stop importing query API implementations from `routes.employee`.
  - Import the new API helpers from a non-legacy module.
- Modify: `routes/api_admin.py`
  - Stop importing admin API implementations from `routes.admin`.
  - Remove the last inline `from routes import admin as admin_module` in account-set import listing.
- Modify: `routes/admin_imports.py`, `routes/admin_attendance_overrides.py`, `routes/admin_accounts.py`
  - Replace `routes.auth` imports with `routes.auth_helpers`.
  - Move any remaining dependency on `routes.admin` to new non-legacy helper modules.
- Create: `routes/admin_core.py`
  - New home for API-safe admin CRUD/list/account-set/business helpers currently reused from `routes.admin`.
- Create: `routes/query_core.py`
  - New home for API-safe query/filter/export helpers currently reused from `routes.employee`.
- Modify: `tests/test_route_separation.py`
  - Add assertions that API blueprints no longer import `routes.admin`, `routes.employee`, `routes.module`, or `routes.auth`.
- Modify: `tests/test_api_admin.py`, `tests/test_api_query.py`, `tests/test_attendance_override_features.py`, `tests/test_permissions_and_leave_rules.py`
  - Update imports from old helper modules to new helper modules.
  - Keep API behavior coverage unchanged.
- Delete:
  - `routes/admin.py`
  - `routes/employee.py`
  - `routes/module.py`
  - `routes/auth.py`
  - `templates/`
  - `static/js/`
  - `static/css/style.css`
  - all tracked `*.orig_backup` files
  - `github-trending-ai-ml.html`
- Delete if tracked or intentionally untrack if generated:
  - `frontend/dist/`
  - `frontend/tsconfig.tsbuildinfo`
  - `frontend/tsconfig.node.tsbuildinfo`
  - `frontend/vite.config.js`
  - `frontend/vite.config.d.ts`

---

### Task 1: Add Legacy Dependency Guard Tests

**Files:**
- Modify: `tests/test_route_separation.py`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/test_route_separation.py`:

```python
    def test_api_modules_do_not_depend_on_legacy_page_modules(self) -> None:
        api_auth_module = importlib.import_module("routes.api_auth")
        api_query_module = importlib.import_module("routes.api_query")
        api_admin_module = importlib.import_module("routes.api_admin")

        legacy_modules = {
            "routes.admin",
            "routes.employee",
            "routes.module",
            "routes.auth",
        }

        for module in (api_auth_module, api_query_module, api_admin_module):
            referenced_modules = {
                value.__module__
                for value in module.__dict__.values()
                if callable(value) and hasattr(value, "__module__")
            }
            self.assertTrue(
                referenced_modules.isdisjoint(legacy_modules),
                f"{module.__name__} still references {referenced_modules & legacy_modules}",
            )
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python3 -m pytest tests/test_route_separation.py::RouteSeparationTests::test_api_modules_do_not_depend_on_legacy_page_modules -q
```

Expected: FAIL showing at least `routes.api_query` references `routes.employee`, or `routes.api_admin` references `routes.admin`.

- [ ] **Step 3: Commit the guard test**

Run:

```bash
git add tests/test_route_separation.py
git commit -m "test: guard api modules from legacy page dependencies"
```

---

### Task 2: Extract Query API Logic From `routes.employee`

**Files:**
- Create: `routes/query_core.py`
- Modify: `routes/api_query.py`
- Modify: `tests/test_attendance_override_features.py`
- Modify: `tests/test_permissions_and_leave_rules.py`

- [ ] **Step 1: Move API-safe code**

Create `routes/query_core.py` by moving these definitions from `routes/employee.py`:

```text
_accessible_emp_ids
_month_date_range
_normalized_leave_days
_manager_options
_fill_manager_template
account_sets_api
departments_api
home_manager_summary_api
final_data_api
final_data_export_api
abnormal_attendance_api
abnormal_attendance_export_api
punch_records_api
punch_records_export_api
department_hours_api
department_hours_export_api
manager_attendance_api
manager_attendance_export_api
manager_attendance_template_export_api
manager_overtime_query_api
manager_annual_leave_query_api
manager_department_hours_api
manager_department_hours_export_api
summary_download_export_api
```

Keep their current function names and behavior. Remove page route decorators and `render_template` usage from the moved module.

- [ ] **Step 2: Update query imports**

In `routes/api_query.py`, replace:

```python
from routes.employee import (
```

with:

```python
from routes.query_core import (
```

- [ ] **Step 3: Update tests importing query helpers**

In `tests/test_attendance_override_features.py`, replace:

```python
from routes.employee import _fill_manager_template, _manager_options
```

with:

```python
from routes.query_core import _fill_manager_template, _manager_options
```

In `tests/test_permissions_and_leave_rules.py`, replace:

```python
from routes.employee import _normalized_leave_days
```

with:

```python
from routes.query_core import _normalized_leave_days
```

- [ ] **Step 4: Run focused query tests**

Run:

```bash
python3 -m pytest tests/test_api_query.py tests/test_attendance_override_features.py tests/test_permissions_and_leave_rules.py tests/test_route_separation.py -q
```

Expected: all selected tests pass, except the new guard may still fail because admin dependencies are not moved yet.

- [ ] **Step 5: Commit query extraction**

Run:

```bash
git add routes/query_core.py routes/api_query.py tests/test_attendance_override_features.py tests/test_permissions_and_leave_rules.py
git commit -m "refactor: move query api logic out of legacy employee routes"
```

---

### Task 3: Extract Admin API Logic From `routes.admin`

**Files:**
- Create: `routes/admin_core.py`
- Modify: `routes/api_admin.py`
- Modify: `routes/admin_imports.py`
- Modify: `routes/admin_attendance_overrides.py`
- Modify: `routes/admin_accounts.py`
- Modify: `tests/test_attendance_override_features.py`
- Modify: `tests/test_permissions_and_leave_rules.py`

- [ ] **Step 1: Move API-safe admin code**

Create `routes/admin_core.py` by moving the non-page admin API helpers and model aliases currently imported from `routes/admin.py`, including:

```text
AccountSet
AccountSetImport
ATTENDANCE_SOURCE_* constants used by imports
_require_model
_serialize_account_set
_serialize_employee
_serialize_department
_serialize_shift
_default_page_permissions_for_role
_factory_rest_unit
_manager_attendance_options
_parse_header_row
_parse_attendance_source
_resolve_department
_resolve_shift
_assign_employee_shift
_ensure_account_set_unlocked
_ensure_year_months_unlocked
_account_set_for_month
_account_set_file_type
_download_manager_stat_template
_import_manager_stat_file
_export_manager_overtime_workbook
_export_manager_annual_leave_workbook
_manager_month_rows
_manager_overtime_values
_annual_leave_value_keys
_manager_annual_leave_values
list_account_sets
create_account_set
update_account_set
activate_account_set
lock_account_set
unlock_account_set
delete_account_set
calculate_account_set
employees_list
create_employee
update_employee
delete_employee
batch_operate_employees
departments_list
create_department
update_department
delete_department
batch_operate_departments
delete_unbound_departments
list_shifts
create_shift
update_shift
delete_shift
manager_overtime_records
manager_annual_leave_records
all attendance override helper functions used by routes/admin_attendance_overrides.py
all department import/export helper functions used by routes/admin_imports.py
```

Do not move page route functions such as `dashboard`, `employees_page`, `departments_page`, or any `frontend_redirect(...)` route.

- [ ] **Step 2: Replace API imports**

In `routes/api_admin.py`, replace:

```python
from routes.admin import (
```

with:

```python
from routes.admin_core import (
```

In `routes/api_admin.py`, replace the inline account-set lookup:

```python
from routes import admin as admin_module
row = admin_module._require_model(AccountSet, account_set_id)
```

with:

```python
from routes.admin_core import _require_model
row = _require_model(AccountSet, account_set_id)
```

- [ ] **Step 3: Replace helper-module imports**

In `routes/admin_imports.py`, `routes/admin_attendance_overrides.py`, and `routes/admin_accounts.py`, replace any of these imports:

```python
from routes import admin as admin_module
from . import admin as admin_module
from routes.auth import admin_required
from routes.auth import frontend_redirect
```

with direct imports from:

```python
from routes import admin_core as admin_module
from routes.auth_helpers import admin_required
```

If a page-only `frontend_redirect` route remains, move that route to the delete batch instead of keeping it.

- [ ] **Step 4: Update tests importing admin helpers**

In `tests/test_attendance_override_features.py`, replace:

```python
from routes.admin import _factory_rest_unit, _manager_attendance_options
```

with:

```python
from routes.admin_core import _factory_rest_unit, _manager_attendance_options
```

In `tests/test_permissions_and_leave_rules.py`, replace:

```python
from routes.admin import _default_page_permissions_for_role
```

with:

```python
from routes.admin_core import _default_page_permissions_for_role
```

- [ ] **Step 5: Run focused admin tests**

Run:

```bash
python3 -m pytest tests/test_api_admin.py tests/test_attendance_override_features.py tests/test_permissions_and_leave_rules.py tests/test_route_separation.py -q
```

Expected: all selected tests pass, including `test_api_modules_do_not_depend_on_legacy_page_modules`.

- [ ] **Step 6: Commit admin extraction**

Run:

```bash
git add routes/admin_core.py routes/api_admin.py routes/admin_imports.py routes/admin_attendance_overrides.py routes/admin_accounts.py tests/test_attendance_override_features.py tests/test_permissions_and_leave_rules.py
git commit -m "refactor: move admin api logic out of legacy admin routes"
```

---

### Task 4: Delete Legacy Flask Page Modules And Assets

**Files:**
- Delete: `routes/admin.py`
- Delete: `routes/employee.py`
- Delete: `routes/module.py`
- Delete: `routes/auth.py`
- Delete: `templates/`
- Delete: `static/js/`
- Delete: `static/css/style.css`
- Modify: tests that explicitly reference deleted files

- [ ] **Step 1: Delete legacy page modules**

Run:

```bash
git rm routes/admin.py routes/employee.py routes/module.py routes/auth.py
```

- [ ] **Step 2: Delete legacy Jinja templates and static browser assets**

Run:

```bash
git rm -r templates static/js
git rm static/css/style.css
```

- [ ] **Step 3: Remove tests that only verify deleted legacy template files**

In `tests/test_attendance_override_features.py`, remove the tests that assert `templates/export_templates/manager_attendance.xlsx` exists or can be filled through the old template path:

```text
test_manager_attendance_template_is_stored_in_repo
test_fill_manager_template_clears_unused_sample_rows
```

Keep API behavior tests for `/api/query/manager-attendance/export-template`.

- [ ] **Step 4: Run route and API tests**

Run:

```bash
python3 -m pytest tests/test_route_separation.py tests/test_api_auth.py tests/test_api_query.py tests/test_api_admin.py -q
```

Expected: all selected tests pass. `/login`, `/employee/dashboard`, `/admin/dashboard`, and `/module/<slug>` remain absent.

- [ ] **Step 5: Commit legacy page deletion**

Run:

```bash
git add -u
git commit -m "refactor: remove legacy flask page routes and assets"
```

---

### Task 5: Delete Backup And Generated Artifacts

**Files:**
- Delete: all tracked `*.orig_backup`
- Delete: `github-trending-ai-ml.html`
- Delete or untrack if tracked: `frontend/dist/`, `frontend/tsconfig.tsbuildinfo`, `frontend/tsconfig.node.tsbuildinfo`, `frontend/vite.config.js`, `frontend/vite.config.d.ts`
- Modify: `.gitignore` if generated artifacts are not ignored

- [ ] **Step 1: List tracked backup files**

Run:

```bash
git ls-files | rg '\\.orig_backup$|github-trending-ai-ml\\.html$'
```

Expected: output lists only backup/scratch files to delete.

- [ ] **Step 2: Delete tracked backup/scratch files**

Run:

```bash
git ls-files | rg '\\.orig_backup$|github-trending-ai-ml\\.html$' | xargs git rm
```

- [ ] **Step 3: Check generated frontend artifacts**

Run:

```bash
git status --short frontend/dist frontend/tsconfig.tsbuildinfo frontend/tsconfig.node.tsbuildinfo frontend/vite.config.js frontend/vite.config.d.ts
git ls-files frontend/dist frontend/tsconfig.tsbuildinfo frontend/tsconfig.node.tsbuildinfo frontend/vite.config.js frontend/vite.config.d.ts
```

Expected: tracked generated artifacts are visible in `git ls-files`; untracked generated artifacts are visible only in `git status`.

- [ ] **Step 4: Remove tracked generated artifacts**

For tracked generated artifacts, run:

```bash
git rm -r frontend/dist frontend/tsconfig.tsbuildinfo frontend/tsconfig.node.tsbuildinfo frontend/vite.config.js frontend/vite.config.d.ts
```

If any path is untracked instead of tracked, leave it alone or add a `.gitignore` rule in the next step.

- [ ] **Step 5: Add ignore rules for generated artifacts**

If `.gitignore` does not already cover them, add:

```gitignore
frontend/dist/
frontend/*.tsbuildinfo
frontend/vite.config.js
frontend/vite.config.d.ts
```

- [ ] **Step 6: Run backup cleanup check**

Run:

```bash
git ls-files | rg '\\.orig_backup$|github-trending-ai-ml\\.html$|^templates/|^static/js/|^static/css/style\\.css$|^routes/(admin|employee|module|auth)\\.py$'
```

Expected: no output.

- [ ] **Step 7: Commit artifact cleanup**

Run:

```bash
git add .gitignore
git add -u
git commit -m "chore: remove backup and generated legacy artifacts"
```

---

### Task 6: Final Verification And README Alignment

**Files:**
- Modify: `README.md` only if it still says legacy templates or legacy page routes exist.

- [ ] **Step 1: Verify README claims**

Run:

```bash
rg -n 'templates/|static/js|static/css/style\\.css|/login|/employee/\\*|/admin/\\*|/module/\\*|legacy templates' README.md
```

Expected: references either describe removed legacy behavior as unavailable, or no longer mention deleted files as current project structure.

- [ ] **Step 2: Update README if needed**

If README still lists deleted files under current structure, replace that section with:

```markdown
- `frontend/`: React + Vite 前端应用
- `routes/api_auth.py`: 认证 API
- `routes/api_query.py`: 查询中心 API
- `routes/api_admin.py`: 管理后台 API
- `routes/query_core.py`: 查询 API 复用业务逻辑
- `routes/admin_core.py`: 管理 API 复用业务逻辑
```

- [ ] **Step 3: Run full backend test suite**

Run:

```bash
python3 -m pytest tests -q
```

Expected: all backend tests pass.

- [ ] **Step 4: Run frontend tests and build**

Run:

```bash
cd frontend
npm test
npm run build
```

Expected: Vitest passes; TypeScript and Vite build pass.

- [ ] **Step 5: Run route exposure smoke check**

Run:

```bash
python3 -m pytest tests/test_route_separation.py::RouteSeparationTests::test_app_routes_only_expose_health_and_api_prefixes -q
```

Expected: pass.

- [ ] **Step 6: Review deletion scope**

Run:

```bash
git status --short
git diff --stat
git diff --name-status
```

Expected: changed files match this plan. No unrelated files are modified.

- [ ] **Step 7: Commit final docs update**

If README changed, run:

```bash
git add README.md
git commit -m "docs: align project structure with api-only backend"
```

If README did not change, skip this commit.

---

## Self-Review

- Spec coverage: The plan covers legacy dependency guards, query extraction, admin extraction, legacy module deletion, template/static deletion, backup/generated artifact cleanup, and final backend/frontend verification.
- Placeholder scan: No unresolved placeholders or open-ended “add tests” steps remain.
- Type consistency: New modules are named `routes/query_core.py` and `routes/admin_core.py` consistently across imports, tests, and README update text.
- Known risk: `routes.admin.py` and `routes.employee.py` currently contain mixed page and API helper logic. The plan intentionally extracts helpers first, then deletes page modules.

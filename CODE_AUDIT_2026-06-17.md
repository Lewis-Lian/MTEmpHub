# MTEmpHub 全量代码检查报告

> **检查日期**：2026-06-17
> **检查方式**：只读核查（未做任何修改）。所有结论均带 `文件:行号` 证据，并通过命令实测验证。
> **范围**：后端 Python（routes / services / models / utils，约 1.1 万行）+ 前端 React/TS（26 个页面、4 个测试文件）+ 配置 / 安全 / 脚本 / 迁移。
> **基线对比**：仓内已有 `CODE_REVIEW_REPORT.md`（2026-06-15），本报告与其差异处会在条目中标注「**已修复**」「**仍存在**」「**新发现**」。

---

## 〇、与上一版报告的总体差异（先看这里）

上一版 `CODE_REVIEW_REPORT.md` 标记的 **6 个「致命级」**问题，经实测：

| # | 上版结论 | 本次实测 | 状态 |
|---|---|---|---|
| 1 | `instance/attendance.db` 泄露到公开 GitHub 历史（85MB，6 个提交） | `git log --all -- instance/attendance.db` 仅 1 个提交 `a24a7e8`，且该提交已**移除**该路径；`git cat-file -s` 在任何历史提交中都拿不到该 blob | ✅ **已修复** |
| 2 | `app.py` 硬编码 `debug=True` → RCE | `app.py:76` 改为 `debug=_resolve_debug_flag()`，仅 `FLASK_DEBUG=1` 才开 | ✅ **已修复** |
| 3 | `change-password` 无 `@login_required` | `routes/api_auth.py:90-91` 仍未加 `@login_required`（要到 127 行才出现） | ❌ **仍存在** |
| 4 | 上传文件名未净化（路径遍历） | `admin_imports.py:53` `upload_excel` 已用 `secure_filename`；`import_raw_files:213`、`import_departments_xlsx:262`、`import_employees_xlsx:438` 改用时间戳命名（不再依赖原始文件名） | ✅ **已修复** |
| 5 | `func.strftime` 跨库不兼容 | 全项目 grep `func.strftime`/`func.year`/`func.month` **0 命中**；现存 `.strftime(...)` 全是 Python 侧 `datetime.strftime` | ✅ **已修复** |
| 6 | 弱密码 `Mt@123`/`admin123`/`mengtian` | `.env` 仍含 `Mt%40123`、`INITIAL_ADMIN_PASSWORD=admin123`；`SETUP_PASSWORD=` 已清空 | 🟡 **部分修复** |

另外上版的「无 CSRF」（#7）已修复：`routes/__init__.py:38-64` 新增了 `configure_csrf_protection`，对 `/api/*` 写请求强制 Origin/Referer 白名单校验；`migrate_mysql_to_sqlite` 也已改为单事务 DELETE+commit（不再 drop_all）。

**所以：上一版报告里 6 个致命级里 4 个已修复，2 个仍存在。但本次又新发现 2 个严重后端死代码 / 路由重复定义问题、1 个明确前端功能 bug、若干安全细节。下面按「当前真实状态」重新分级。**

---

## 一、🔴 致命级（必须立即处理）

### 1. 改密码接口仍无登录校验 + 仍可越权改任意用户密码 ❌ 仍存在
- **证据**：`routes/api_auth.py:90-91`
  ```python
  @api_auth_bp.post("/change-password")
  def api_change_password():     # ← 注意：这里没有 @login_required
  ```
  `@login_required` 要到第 127 行（`api_me`）才出现。
- **当前实现**（`api_auth.py:92-123`）：仅凭请求体里的 `username + current_password` 验证，任何人都可为任意 username 改密，且复用了账号锁定逻辑但**不要求登录态**。
- **影响**：
  - 用户名枚举（不同响应区分「用户不存在」与「密码错误」？看 `:110` 行，统一返回「用户名或原密码错误」，这一条 OK；但锁定状态分支会泄露账号是否存在）。
  - 在线爆破原密码（虽有 5 次/10 分钟锁定兜底，但接口本身对外完全开放）。
- **修复建议**：加 `@login_required`，强制只能改 `g.current_user.username` 对应用户的密码（拒绝请求体里的 `username` 字段或校验其等于当前登录用户）。

### 2. `admin_imports.py` 中 `register_admin_import_routes` 是整段死代码，且与模块级同名函数冲突 ⚠️ 新发现
- **证据**：
  - `routes/admin_imports.py:15` 定义了 `register_admin_import_routes(admin_bp)`，内部嵌套定义了 `list_account_set_imports`、`upload_excel`、`download_manager_overtime_template`、`import_manager_overtime`、`export_manager_overtime`、`download_manager_annual_leave_template`、`import_manager_annual_leave`、`export_manager_annual_leave` 共 8 个视图函数，并调用 `admin_bp.add_url_rule(...)` 注册路由。
  - 全项目 grep `register_admin_import_routes` **只在定义处出现 1 次，零调用**。
  - 同一文件第 117-167 行又**以模块级 `@admin_required` 形式重复定义**了 `download_manager_overtime_template`、`import_manager_overtime`、`export_manager_overtime`、`download_manager_annual_leave_template`、`import_manager_annual_leave`、`export_manager_annual_leave` 6 个同名函数，被 `routes/api_admin.py:43-57` import 后挂到 `api_admin_bp` 上。
- **后果**：
  - `register_admin_import_routes` 内部那套 `upload_excel`、`list_account_set_imports`、`/account-sets/<id>/imports`（蓝图版）**从未生效**——但同名的 `/account-sets/<id>/imports` 在 `api_admin.py:704` 重新实现了一份（`account_set_imports`），实际生效的是后者。
  - 维护时极易改错地方：例如有人去改 `register_admin_import_routes` 里的 `import_manager_overtime`，以为生效，其实真正生效的是文件底部第 124 行那版。
- **修复建议**：直接删除 `admin_imports.py:15-114` 整个 `register_admin_import_routes` 函数（死代码）。

### 3. 数据库凭据与初始密码仍为弱值 🟡 部分修复
- **证据**：
  - `.env:2` `DATABASE_URL=mysql+pymysql://root:Mt%40123@172.16.20.16:3306/...` —— 用 **root** 账号、密码 `Mt@123`。
  - `.env:6` `INITIAL_ADMIN_PASSWORD=admin123`。
  - `.env:7` `MYSQL_SAVED_URL=...root:Mt%40123@...` —— 同 root 密码再次明文落盘。
  - 前端 `AccountsPage.tsx` 等历史代码中还有硬编码 `mt@123`（上版报告点名，未复查是否已清）。
- **影响**：`.env` 本身未被 git 跟踪（✅），但一旦开发机/服务器被入侵即明文泄露；用 root 连库违反最小权限原则。
- **修复建议**：① 为应用建受限 DB 账号（仅 `attendance_db.*` 的 CRUD，禁 DDL/Drop）；② 轮换所有密码为强随机值；③ `INITIAL_ADMIN_PASSWORD` 仅用于首次 bootstrap，建账后立即改密。

---

## 二、🔴 高危（安全 / 数据完整性）

### 4. `setup_required` 用 `==` 比较密码（非时序安全），且不要求登录 ❌ 仍存在
- **证据**：`routes/api_admin.py:103` `if not provided_password or provided_password != required_password:`
- **守护范围**：`/database-settings`(PUT)、`/database-test-connection`、`/database-migrate`、`/database-migrate-to-sqlite`、`/database-switch-sqlite`、`/database-switch-mysql` 共 6 个接口（`api_admin.py:148-350`），其中 `database-migrate-to-sqlite` / `database-switch-*` 可清空/切换生产库。
- **影响**：
  - `==` 字符串比较存在时序侧信道（理论上可逐字节爆破 `SETUP_PASSWORD`）；当前 `.env` 里 `SETUP_PASSWORD=` 为空，`setup_required` 会直接返回 403「请先设置 SETUP_PASSWORD」（`api_admin.py:99-100`），所以**目前不可利用**；但一旦设了密码就回到风险。
  - 这 6 个接口**不要求管理员登录态**，仅靠一个 header 密码保护，且经 `X-Setup-Password` header 传输易被 nginx/uvicorn 访问日志记录。
- **修复建议**：① 改 `hmac.compare_digest(provided_password, required_password)`；② 叠加 `@admin_required`；③ 生产关闭这一组接口或加 IP 白名单。

### 5. `test_database_connection` 把原始异常 `str(e)` 返回前端 ⚠️ 仍存在
- **证据**：
  - `services/migration_service.py:136` `return {"ok": False, "message": str(e)}`
  - `routes/api_admin.py:250` 直接 `jsonify({"ok": False, "message": result["message"]})` 返回前端。
- **对比**：同文件 `database_migrate`（`:286-288`）和 `database_migrate_to_sqlite`（`:320-322`）已正确脱敏（`logger.exception(...)` + 返回「请查看服务端日志」），唯独**测试连接**没脱敏。
- **影响**：连接失败时会把 pymysql 原始异常（含主机、端口、可能的部分连接串）回传前端，进而暴露到浏览器/日志。
- **修复建议**：统一改成 `logger.exception(...)` + 通用提示。

### 6. 多处 `str(exc)` 入库 / 返回前端 ⚠️ 仍存在
- **证据**：
  - `routes/admin_core.py:1044` `rec.error_message = str(exc)`（写 `AccountSetImport` 表）
  - `routes/admin_core.py:1046` `"error": str(exc)`（`calculate_account_set` 返回前端）
  - `routes/admin_imports.py:237` `import_record.error_message = str(exc)`（入库）
  - `routes/admin_imports.py:238` `"error": str(exc)`（返回前端）
- **影响**：异常字符串可能含 SQL 文本、表名、文件路径，经 `_serialize_account_set` 暴露到前端（`admin_core.py:724` 的 `error_message` 字段）。
- **修复建议**：服务端 `logger.exception(...)`，前端只展示分类后的简短错误（如「导入失败，请检查文件格式」）。

### 7. Session Cookie 默认非 Secure ❌ 仍存在
- **证据**：`config.py:35` `SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"` —— 默认 `false`。
- **影响**：Cookie 含 JWT，HTTP 下可被中间人嗅探。生产 Nginx 若仅监听 80（未确认是否已上 HTTPS）则风险成立。
- **修复建议**：生产强制 `SESSION_COOKIE_SECURE=true` 并上 HTTPS。

---

## 三、🟡 中危（后端）

### 8. 所有 `openpyxl.load_workbook` 都没有 `wb.close()` ⚠️ 仍存在
- **证据**：全项目 grep `wb.close()`/`workbook.close()` **0 命中**；9 处 `load_workbook`：
  - `utils/excel_parser.py:24`
  - `routes/query_core.py:2235`
  - `routes/admin_attendance_overrides.py:328`（read_only）、`:450`（read_only）
  - `routes/admin_core.py:1757`、`:1880`、`:1904`
  - `routes/admin_imports.py:268`、`:444`（read_only）
- **影响**：`read_only=True` 模式会长期持有文件句柄和临时 zip 资源，高并发或连续导入大文件时可能耗尽句柄；非 read_only 模式下 zip 句柄滞留。
- **修复建议**：改用 `with openpyxl.load_workbook(...) as wb:` 上下文管理，或在函数末尾 `finally: wb.close()`。

### 9. 导入接口 N+1 查询（循环内逐行查库）⚠️ 部分修复
- **已优化**：`services/import_service.py` 的 daily/monthly/overtime/leave 已全部改成批量 `IN` 预查 + 内存 dict（上版报告点名，已修）。
- **仍存在**：
  - `routes/admin_attendance_overrides.py:358` 循环内 `Employee.query.filter_by(emp_no=emp_no).first()`
  - `routes/admin_attendance_overrides.py:396-398` 循环内 `ManagerAttendanceOverride.query.filter_by(emp_id, month).first()`
  - `routes/admin_attendance_overrides.py:480` 循环内 `Employee.query.filter_by(emp_no=emp_no).first()`
  - `routes/admin_attendance_overrides.py:516-518` 循环内 `EmployeeAttendanceOverride.query.filter_by(...).first()`
  - `routes/admin_core.py:1776` `_import_manager_stat_file` 循环内 `ManagerMonthStat.query.filter_by(emp_id, year, stat_type).first()`
- **影响**：大文件（数千行）会产生数千次查询。
- **修复建议**：仿 `import_service.py` 的批量预查模式。

### 10. 迁移服务「SQLite → MySQL」仍逐表 commit，中途失败前表不回滚 ⚠️ 部分修复
- **证据**：
  - `services/migration_service.py:97-100` 循环内每个 batch 后 `write_db.session.commit()`，且每张表独立 commit。
  - 对比 `migrate_mysql_to_sqlite`（`:189-206`）已是「单事务全表写入，全部成功才 commit」。
- **影响**：sqlite→mysql 中途失败，前 N 张表已落 MySQL，后 N 张表缺失，目标库半残；MySQL 侧没有像 SQLite 那样的「先 DELETE 再 INSERT」清理逻辑，重跑会主键冲突。
- **修复建议**：改成单事务，或失败时提供「清理目标库已写表」的回滚路径。

### 11. `datetime.utcnow()` 广泛使用（Python 3.12+ 已 DeprecationWarning）⚠️ 仍存在
- **证据**（17 处）：
  - 业务逻辑：`models/user.py:110,126`、`routes/admin_core.py:949`、`routes/api_auth.py:41,103`、`routes/admin_accounts.py:31`
  - 模型 default：`models/user.py:59`、`models/employee.py:26`、`models/account_set.py:18,19,40,56`、`models/attendance_override_history.py:20`、`models/manager_attendance_override.py:20`、`models/employee_attendance_override.py:18`
  - 测试：`tests/test_api_admin.py:315`、`tests/test_api_auth.py:288`
- **影响**：
  - 3.12+ 运行时会抛 DeprecationWarning；未来版本会移除。
  - **更现实的隐患**：项目里 `datetime.now()`（local）和 `datetime.utcnow()`（UTC）混用——例如 `admin_imports.py:213` 用 `datetime.now().timestamp()` 命名文件（local），而 `user.login_locked_until` 用 `utcnow()+timedelta(minutes=10)` 写入（UTC）。一旦某条路径被改成 `datetime.now()` 就会出现 8 小时偏差，导致锁定判断错乱。
- **修复建议**：统一改为 `datetime.now(timezone.utc)`（aware），或全部 local naive，二选一。

### 12. 死代码：`services/report_service.py` 整个 `ReportService` 类全项目零引用 ⚠️ 仍存在
- **证据**：`grep -rn "ReportService\|report_service" --include="*.py"` 除自身定义外 **0 命中**。当前在用的 CSV 导出是 `routes/query_core.py` 内联实现。
- **修复建议**：删除整个文件，或确认是否还有未接入的计划。

### 13. 死代码：`manager_attendance_service.py` 内 3 个私有函数零调用 ⚠️ 仍存在（上版报告的部分项已清，剩余这 3 个）
- **证据**（全项目 grep 验证）：
  - `services/manager_attendance_service.py:290-292` `_manager_month_stat`（单参版；真正在用的是批量版 `_manager_month_stats_by_employee:295`，被 `:499` 调用）
  - `services/manager_attendance_service.py:308-312` `_stat_month_value`（唯一调用者是下一个死函数）
  - `services/manager_attendance_service.py:315-317` `_required_stat_month_value`（零外部调用）
- **附**：上版报告点名的 `_manager_attendance_days`/`_schedule_late_minutes`/`_stat_remaining`/`_compute_overtime_used`/`_benefit_used`/`_override_row`/`_overtime_rows`/`_leave_rows` 等无后缀单参版**已不存在**，现存 `*_from_row`/`*_from_views`/`*_by_employee` 批量版均有真实调用点。
- **未使用 import**：`services/manager_attendance_service.py:11` `from models.daily_record import DailyRecord` 全文零引用。
- **修复建议**：删除上述 3 个函数 + 1 个 import。

### 14. 重复代码
- **`_accessible_*_set` 两处几乎相同**：`routes/admin_core.py:166-198`（`_accessible_emp_ids_set`，返回 set）与 `routes/query_core.py:649-680`（`_accessible_emp_ids`，返回 list），逻辑一致仅返回类型不同；可抽公共。
- **`_filter_columns` 与 `_filter_requested_columns` 逐字符相同**：`routes/query_core.py:128-141` 与 `:144-157`，两个完全一样的函数。
- **`_manager_raw_score` 重复定义**：`services/manager_attendance_service.py:108-128` 与 `services/import_service.py:200-207`，语义相同但 keys 集合不一致（有行为分歧风险）。
- **`users_list_api` 与 `disabled_users_list_api` 重复**：`routes/admin_accounts.py:10-25` 与 `:28-48`，前 14 行完全一致，仅末尾过滤条件不同。

### 15. `_compat_app` 全局单例懒加载非线程安全 ⚠️ 仍存在
- **证据**：`app.py:27,53-57`
  ```python
  _compat_app: Flask | None = None
  def _get_compat_app() -> Flask:
      global _compat_app
      if _compat_app is None:
          _compat_app = create_app()
      return _compat_app
  ```
- **影响**：`flask --app app:app`（`macrun2.sh:74` 用的就是这种入口）在多线程 gunicorn 下，首次并发访问可能创建多个 app 实例。
- **缓解**：生产实际走 `wsgi.py`（`app = create_app()` 模块级立即初始化），`app:app` 主要用于本地开发。
- **修复建议**：用 `functools.lru_cache(maxsize=1)` 或模块级直接 `app = create_app()`。

### 16. 入口不统一
- `macrun2.sh:74` `flask --app app:app run`（走 `_compat_app` 懒加载）
- `winrun.sh:82`、`update.sh:50`、`deploy_production.ps1:76` `flask --app manage.py ...`（走 `manage.py` 模块级 `app = create_app()`）
- `wsgi.py` 又是第三种 `from app import create_app; app = create_app()`
- 三者等价但易混淆，建议统一到 `wsgi.py` 或 `manage.py`。

---

## 四、🔴 前端：明确的功能 Bug

### 17. ~~`QueryTable.tsx` 把数值 0 误判为「无数据」，导致 0 值单元格无法点开详情~~ ✅ 非 bug（用户确认：0 值不渲染点击按钮是有意设计）
- **证据**：`frontend/src/components/query/QueryTable.tsx:310`
  ```ts
  const isNoData = !strVal || strVal === "-" || strVal === "0" || strVal === "0.0" || strVal === "0.00";
  ```
  第 312-314 行 `if (isNoData) return cellValue ?? ""`，跳过点击打开详情 modal 的渲染。
- **更正（2026-06-17）**：经与用户确认，**0 值单元格不渲染点击按钮是有意设计**——0 表示该维度无明细数据（如本月加班 0 小时 = 无加班记录可查），点开看到空明细没有意义。原报告将其判为「功能 bug」是误判，已回退试探性修改，保留原逻辑。

### 18. `QueryTable.tsx` 渲染期 IIFE + 每个单元格调 `getModal()` ⚠️ 性能问题
- **证据**：`frontend/src/components/query/QueryTable.tsx:297-326`
  ```tsx
  {(() => { ... cellModal?.getModal({...}) ... })()}
  ```
  在每次 render、每个单元格（`rowIndex × columnIndex`，pageSize 可达 200，见 `:41`）都同步构造 context 并调 `getModal`。
- **影响**：大表渲染卡顿。
- **修复建议**：`useMemo` 预算，或把 modal 触发逻辑挪到点击回调里惰性执行。

### 19. `client.ts` 不支持请求取消 + `String(payload.error)` 粗糙 ⚠️ 仍存在
- **证据**：`frontend/src/api/client.ts`
  - `:17` `RequestOptions = Omit<RequestInit,"body">` 虽然保留了 `signal`，但全项目无任何调用方传入（grep 确认）。QueryPage 频繁切换时旧请求仍打满后端。
  - `:50` `String(payload.error)`：后端 `error` 若是 `{message:"..."}` 对象，得到 `"[object Object]"`。
- **修复建议**：给 `apiRequest` 加 `signal` 透传并在 QueryPage 等页面用 `AbortController`；`error` 改读 `payload.error.message ?? JSON.stringify(payload.error)`。

---

## 五、🟡 前端代码质量

### 20. 测试配置缺失 `define`，导致全代码库打 `isTestEnv` 补丁 ⚠️ 仍存在
- **证据**：`frontend/vite.config.ts:30-33` test 块只用 `env: { NODE_ENV: "test" }`，而 `process.env` 在 jsdom 环境不存在，业务代码读 `process.env.NODE_ENV` 得到 `undefined`，被迫在 4 个组件里打 hack：
  - `frontend/src/components/query/QueryTable.tsx:59-61`
  - `frontend/src/components/query/DepartmentPicker.tsx:136-138`
  - `frontend/src/components/query/DepartmentMultiPicker.tsx:222-224`
  - `frontend/src/components/query/EmployeePicker.tsx:221-223`
  - 测试文件 `QueryTable.test.tsx:154-184` 还要手动改 `globalThis.process.env.NODE_ENV`。
- **修复建议**：vitest 配置加 `define: { 'process.env.NODE_ENV': '"test"' }`（生产构建会注入 `"production"`），然后删除上述 4 处 `isTestEnv` hack。

### 21. `tsconfig` 配置冲突 + 编译产物残留 ⚠️ 仍存在
- **证据**：
  - `frontend/tsconfig.json:12` `"noEmit": true` 与 `:20` `references: [{ "path": "./tsconfig.node.json" }]` 冲突——被引用的 `tsconfig.node.json:3` 设了 `"composite": true`，composite 要求能 emit。
  - `package.json:8` `"build": "tsc -b && vite build"`，`tsc -b` 在 composite 项目上会尝试产出。
  - 本地残留：`frontend/vite.config.js`、`frontend/vite.config.d.ts`、`frontend/tsconfig.tsbuildinfo`、`frontend/tsconfig.node.tsbuildinfo`（均未被 git 跟踪，✅ .gitignore 已覆盖，但本地需清理）。
- **修复建议**：根 `tsconfig.json` 去掉 `noEmit`（让 composite 子项目正常产出 tsbuildinfo），或改为不使用 project references；清理本地残留产物。

### 22. 多处 `setInterval`/`setTimeout` 无 cleanup（卸载后 setState）⚠️ 仍存在
- **证据**（事件回调里的定时器，不在 effect 内，无 cleanup）：
  - `frontend/src/pages/query/SummaryDownloadPage.tsx:251-268`（`setInterval` + 两个嵌套 `setTimeout`）
  - `frontend/src/pages/query/QueryPage.tsx:275-277`
  - `frontend/src/pages/query/AbnormalQueryPage.tsx:183-185`
  - `frontend/src/pages/admin/AdminDashboardPage.tsx`（541/622/669/714/759/926/1097 等多处）
  - `frontend/src/components/admin/AttendanceOverridesPage.tsx:171-197`
  - `frontend/src/components/admin/ManagerMonthStatPage.tsx:115-143`
  - `frontend/src/components/feedback/Notification.tsx:180`（`handleClose` 内的 `setTimeout`，与 `:194` effect 内有 cleanup 的那处不同）
- **影响**：组件卸载后定时器仍触发 `setState`，React 会告警「Can't perform a state update on unmounted component」，严重时内存泄漏。
- **修复建议**：把定时器收进 `useEffect` 并在 cleanup 里 `clearInterval`/`clearTimeout`，或保留 `mounted` ref 守卫。

### 23. 多个管理页异步加载无 `mounted` 守卫 ⚠️ 仍存在
- **证据**：
  - `frontend/src/pages/admin/AccountsPage.tsx:106-127` `loadPage` 在 `await Promise.all` 后直接 `setUsers/...`，无 mounted 检查（对比同目录 `AdminResourcePage.tsx:27-56`、`AdminDashboardPage.tsx:97-123` 都有）。
  - `DepartmentsPage.tsx`、`EmployeesPage.tsx`、`ShiftsPage.tsx`、`DisabledUsersPage.tsx` 同样无守卫。
- **修复建议**：统一加 `const mounted = useRef(true); useEffect(() => () => { mounted.current = false; }, []);`，setState 前判断。

### 24. 模块级缓存永不过期 / 失败 promise 永久缓存 ⚠️ 仍存在
- **证据**：`frontend/src/api/query.ts:9-24` `queryBootstrapPromise` 模块级单例，仅靠 `clearQueryBootstrapCache()`（AppShell 登出时调用）手动清理；若请求失败，promise 会**永久缓存 rejected promise**，后续所有 `fetchQueryBootstrap()` 永远 reject 且不重试。
- **对比**：上版报告点名 `admin.ts:14` 的 `adminBootstrapPromise` 也是同类问题（未复查是否已修）。

### 25. 弱类型与坏味道
- `frontend/src/api/admin.ts:273,275,278,280` 4 处 `results?: any`（迁移结果链路类型全失）。
- `frontend/src/pages/admin/DatabaseSettingsPage.tsx` 8 处 `catch (err: any)`（与 `tsconfig.json:14` 开启 `strict` 相悖）。
- `frontend/src/components/admin/AttendanceOverridesPage.tsx:260,321` 用 `window.alert` 做成功反馈，与同文件 `notification.error(...)`（`:195`）风格不一致，且阻塞 UI、无法被测试断言。
- `frontend/src/components/query/QueryTable.tsx:294,296` 列表 `key` 用 array index，配合分页/排序会导致 React 复用错误 DOM。

---

## 六、🟢 低危（后端代码质量）

### 26. `migrations/versions/` 唯一迁移「名不副实」 ⚠️ 仍存在
- **证据**：`migrations/versions/681e8410935f_initial_schema.py:19-24` 的 `upgrade()` **只创建 1 个外键**（`account_sets.locked_by → users.id`），不建任何表。真实 schema 实际由 `db.create_all()`（`services/migration_service.py:78,177`）+ `ensure_schema_compatibility()`（`services/bootstrap_service.py:33`）维护。
- **影响**：`winrun.sh:82`、`deploy_production.ps1:76` 的 `flask --app manage.py init-db` → `flask_migrate.upgrade()` 在**全新空库**上会因 `account_sets` 表不存在而失败；之所以在现有环境能跑，是因为 `upgrade()` 之后紧跟 `ensure_schema_compatibility()` 且环境通常已有旧库。`update.sh:48-50` 已显式注释回避 `init-db`，改用 `upgrade-legacy-schema`。
- **修复建议**：要么补全 alembic 迁移历史（让 `upgrade()` 真正建表），要么明确文档化「schema 靠 `create_all` + `ensure_schema_compatibility`，alembic 仅用于 stamp」。

### 27. `switch_sqlite.py` 无确认覆写 `.env` ⚠️ 仍存在
- **证据**：`switch_sqlite.py:34-35` `open(env_path, "w", encoding="utf-8")` 整体覆盖 `.env`，无备份、无确认提示，运行即生效。
- **影响**：生产服务器误执行会把 `DATABASE_URL` 静默切到 `sqlite:///attendance.db`，导致写入分流到本地文件、MySQL 数据不再更新，且无回滚。
- **缓解**：`:20-30` 按 key 精确替换并保留其它键，不会破坏 `.env` 其余内容。
- **修复建议**：加 `input("确认切换到 SQLite？(y/N)")` 二次确认；或限定只在 `APP_ENV=development` 时可用。

### 28. `test_api.py` 是过期调试探针
- **证据**：根目录 `test_api.py:6` 硬编码 `{"username": "admin", "password": "123"}`，但真实密码来自 `INITIAL_ADMIN_PASSWORD`（`config.py:36`），`"123"` 几乎不可能登录成功；文件不在 `tests/` 内，不会被 pytest 收集，运行后只 `print` 不做断言。
- **修复建议**：删除，或迁入 `tests/` 并改为参数化。

### 29. 路径遍历已修复，但 `import_employees_xlsx` 等仍用 `data_only=True` 不 close
- 见 §8（已统一在「wb.close」条目下）。

### 30. 其它小问题
- `routes/auth_helpers.py:114` `payload.get("sub")` 已改用 `.get`（✅ 上版报告点名的 `payload["sub"]` KeyError 已修）。
- `frontend/src/pages/query/QueryHomePage.tsx:144` `<span style={{display:"none"}}>` 死代码（上版点名，未复查）。
- `frontend/src/layouts/AppShell.tsx:106-123` `account-set-active-changed` 监听随 tabs/path 频繁重订阅（有 cleanup，功能正确，效率低）。

---

## 七、✅ 已经做对的地方（避免误判）

- **数据库泄露历史已清除**：`git log --all` 在任何历史提交都拿不到 `instance/attendance.db` 的 blob。
- **`app.run` debug 已改成环境变量控制**（`app.py:60-65,76`）。
- **CSRF 已加上**（`routes/__init__.py:38-64` Origin/Referer 白名单）。
- **CORS 支持多前端来源白名单**（`config.py:28-31`、`routes/__init__.py:11-21`）。
- **`SECRET_KEY` 启动时拒绝占位符**（`config.py:17-22,42-49`）；当前 `.env` 用的是 64 位十六进制强密钥。
- **上传文件名已净化**（`admin_imports.py:53` `secure_filename`）。
- **`func.strftime` 跨库问题已消除**（全项目 0 命中 SQL 侧 strftime）。
- **`migrate_mysql_to_sqlite` 已事务化**（单事务 DELETE+INSERT+commit）。
- **密码用 werkzeug pbkdf2:sha256 哈希存储**。
- **登录失败锁定**（5 次/10 分钟临时锁、10 次/永久禁用）。
- **JWT 显式 HS256 + exp 校验**。
- **`.gitignore` 基本到位**，`.env`、`*.db`、编译产物均被忽略；前端残留构建产物虽在本地存在但未被 git 跟踪。
- **运维脚本（`update.sh`/`restart.sh`）整体安全**：`set -euo pipefail`、`git pull --ff-only`、重启后 `systemctl is-active` 校验、平台 lockfile 处理有注释。
- **测试无 skip/xfail/.only 标记**，断言具体非空泛（除 `test_run_scripts.py` 只 assertIn 字面量属弱断言）。

---

## 八、优先处置清单

| 优先级 | 任务 | 涉及 | 证据 |
|---|---|---|---|
| **立刻** | `change-password` 加 `@login_required` 并限定只能改自身 | 后端 | `routes/api_auth.py:90-91` |
| **立刻** | 删除 `admin_imports.py:15-114` 的 `register_admin_import_routes` 死代码 | 后端 | 全项目零调用 |
| **本周** | `setup_required` 改 `hmac.compare_digest` + 叠加 `@admin_required` | 后端 | `routes/api_admin.py:103` |
| **本周** | 6 处 `str(exc)` 改为 `logger.exception` + 通用提示 | 后端 | 见 §5、§6 |
| **本周** | `QueryTable.tsx:310` 修 `isNoData` 误判 0 值 | 前端 | 明确功能 bug |
| **本周** | 轮换弱密码（root/Mt@123、admin123），建受限 DB 账号 | 运维 | `.env:2,6` |
| **计划内** | 9 处 `load_workbook` 加 `wb.close()` 或 `with` | 后端 | 见 §8 |
| **计划内** | 导入接口 N+1 批量化（overrides、manager stat） | 后端 | 见 §9 |
| **计划内** | `datetime.utcnow()` 统一为 aware UTC 或 local naive | 后端 | 17 处，见 §11 |
| **计划内** | 删除死代码：`report_service.py` 整文件、`manager_attendance_service.py` 3 个私有函数 | 后端 | 见 §12、§13 |
| **计划内** | 前端 vitest 加 `define`、删 4 处 `isTestEnv` hack | 前端 | 见 §20 |
| **计划内** | 前端 `setInterval`/`setTimeout` cleanup + mounted 守卫 | 前端 | 见 §22、§23 |
| **计划内** | 生产强制 `SESSION_COOKIE_SECURE=true` + 上 HTTPS | 运维 | `config.py:35` |
| **低** | `switch_sqlite.py` 加二次确认；`test_api.py` 删除或迁移 | 运维 | 见 §27、§28 |

---

## 九、附：检查方法说明

- **后端**：通读 `app.py`/`config.py`/`routes/`/`services/`/`utils/`/`models/`，对每条怀疑点用 `grep -rn` 全项目验证调用关系，区分「定义存在」与「真实被调用」。
- **前端**：并行启动只读探查 agent，覆盖构建配置、测试配置、React 反模式、功能 bug、弱类型。
- **安全**：核查所有写接口的装饰器覆盖（`@login_required`/`@admin_required`/`@setup_required`）、密码比较方式、异常信息泄露、Cookie 安全属性。
- **运维**：通读 `update.sh`/`restart.sh`/`winrun.sh`/`macrun2.sh`/`switch_sqlite.py`/`manage.py`/`deploy_production.ps1`，核查危险操作与平台假设。
- **历史**：用 `git log --all` + `git cat-file -s` 核查数据库泄露是否已彻底清除。
- **未实际运行测试**：本报告基于代码静态分析与 grep 验证，未执行 `pytest`/`vitest`（用户要求「先不做修改」）。如需验证测试当前是否真的全绿，需单独跑一次。

---

## 十、🛠️ 修复进度（2026-06-17）

> 本轮已按报告逐项修复。**验证结果：后端 119 个测试全绿、前端 73 个测试全绿，无回归。**
> 改动遵循 AGENTS.md「surgical changes」原则：仅改必要处，保留有意设计。

### 已修复（13 项）

| 报告条目 | 改动 | 文件 |
|---|---|---|
| §1（待确认） | `setup_required` 改 `hmac.compare_digest`，时序安全比较；**不叠加 `@admin_required`**（该接口是首次部署向导，守护 `/database-setup`，此时还没有 admin 账号，叠加会破坏首次部署） | `routes/api_admin.py:2,103-105` |
| §2 | 删除 `register_admin_import_routes` 整段死代码（100 行，全项目零调用，与模块级同名函数冲突） | `routes/admin_imports.py` |
| §5/§6 | 4 处真正泄露内部信息的 `str(exc)` 改为 `logger.exception` + 通用提示「请查看服务端日志」；**保留** §5.1 中 `create_account_set`/`update_account_set` 的 `ValueError`（那是用户输入校验的友好提示，脱敏反而有害） | `routes/admin_core.py:1074`、`routes/admin_imports.py:137`、两文件加 `logger` |
| §8 | 9 处 `openpyxl.load_workbook` 全部加 `try/finally: wb.close()`（含 read_only 模式的文件句柄） | `utils/excel_parser.py`、`routes/admin_imports.py`、`routes/admin_attendance_overrides.py`、`routes/admin_core.py`、`routes/query_core.py` |
| §12 | 删除整文件 `services/report_service.py`（全项目零引用，CSV 导出实际由 `query_core.py` 内联） | 删除 `services/report_service.py` |
| §13 | 删除 3 个死函数 `_manager_month_stat`/`_stat_month_value`/`_required_stat_month_value` + 未用 import `DailyRecord` | `services/manager_attendance_service.py` |
| §14 | 合并 `_filter_punch_columns`（逐字符重复）到通用 `_filter_columns`，2 处调用点同步改写 | `routes/query_core.py` |
| §17 | **非 bug，已回退**。用户确认 0 值单元格不渲染点击按钮是有意设计（0 = 无明细数据），原报告误判 | `frontend/src/components/query/QueryTable.tsx:310`（保留原逻辑） |
| §20 | 评估后**跳过**：实测前端 73 测试全绿，`isTestEnv` hack 虽丑但工作正常；用 `define` 重写有破坏测试风险，收益低 | （未改动） |
| §22 | 修复最典型的两处定时器泄漏：`Notification.tsx` handleClose 用独立 `leaveTimerRef` + 卸载清理；`SummaryDownloadPage` 进度条 interval/timeout 存 ref + 卸载清理 | `frontend/src/components/feedback/Notification.tsx`、`frontend/src/pages/query/SummaryDownloadPage.tsx` |
| §23 | `AccountsPage.loadPage` 加 `mountedRef` 守卫，卸载后不 setState（对比同目录其他页面已有守卫） | `frontend/src/pages/admin/AccountsPage.tsx` |
| §client | `extractErrorMessage` 智能提取：字符串直接用、对象取 `.message`、降级 `JSON.stringify`，避免 `String()` 得到 `"[object Object]"` | `frontend/src/api/client.ts` |
| §27 | `switch_sqlite.py` 加二次确认（默认 `input`，`--force` 跳过兼容自动化）+ 自动备份 `.env` 到 `.env.bak` | `switch_sqlite.py` |

### 待用户决策（1 项）

#### §3 改密码接口 `change-password` 是否加 `@login_required`？
- **现状**：`routes/api_auth.py:90` 的 `/api/auth/change-password` **无登录校验**，任何人可凭 `username + current_password` 改密（复用了 5 次/10 分钟账号锁定）。
- **设计冲突**：前端 `/change-password` 是**公开页面**（`router/index.tsx:33` 不在 `ProtectedRoute` 内，`LoginPage.tsx:147` 有「修改密码」入口）。用户在**未登录**状态下走「自助改密」流程。
- **报告建议**「加 `@login_required` 并限定只能改自身」会**直接破坏这个公开自助改密流程**。
- **需用户决策**：
  - 方案 A：保持现状（自助改密，依赖 current_password + 账号锁定，本质是「第二次登录验证」模型）。
  - 方案 B：把改密移到登录后（加 `@login_required`），同时移除前端公开 `/change-password` 页面和登录页的入口。
  - 方案 C：保留公开页面，但后端额外限制（如 IP 频率限制、验证码）。

### 未做（列为后续技术债，原因已注明）

| 报告条目 | 原因 |
|---|---|
| §3（弱密码 `Mt@123`/`admin123`） | 属运维/部署操作，需用户在服务器轮换，非代码改动 |
| §7（Session Cookie Secure） | 需生产环境配置 `.env` + 上 HTTPS，非代码改动 |
| §9（导入接口 N+1） | `import_service.py` 已批量化；`admin_attendance_overrides.py`、`admin_core.py:1776` 未跟进，改动量大，留作后续 |
| §11（`datetime.utcnow()` 17 处） | 涉及 model default + 业务逻辑 + 测试 mock，统一改造影响面大，留作后续 |
| §14（`_accessible_*_set` 重复等） | 逻辑一致但返回类型不同（set vs list），合并需仔细处理调用方，留作后续 |
| §15（`_compat_app` 线程安全） | 生产走 `wsgi.py`（模块级立即初始化），`app:app` 仅本地开发，风险低 |
| §22（剩余定时器：QueryPage/AbnormalQueryPage/AdminDashboardPage 等） | 这些多是「请求完成后延迟隐藏 loading」，React 18 仅静默告警不崩溃，危害低；逐个改造收益递减 |
| §23（DepartmentsPage/EmployeesPage/ShiftsPage/DisabledUsersPage 守卫） | 模式相同，AccountsPage 已示范，其余留作后续批量处理 |
| §24（query.ts 失败 promise 永久缓存） | 需重构模块级缓存为「失败即重置」语义，改动需配套测试，留作后续 |
| §25（弱类型 `any`、`window.alert`） | 代码风格问题，非 bug，留作后续 |
| §26（migrations 空壳） | 需决策 schema 管理策略（补全 alembic 或文档化 create_all），留作后续 |
| §28（`test_api.py` 过期探针） | 删除即可，但需确认无人依赖，留作后续清理 |

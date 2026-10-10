# 多月份备份与选择性恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 未经用户明确选择，不自动派发子代理。每个阶段先阅读配套设计及本阶段，再写失败测试、最小实现、验证并更新复选框。

**Goal:** 实现月份多选、内容可选、默认按备份恢复、多选差异处理、完整当前资料与账号备份，同时保护未选历史月份并保持旧备份兼容。

**Architecture:** 先建立月度历史资料隔离，再建立 v1/v2 统一内部文档及数据覆盖登记。复用现有 ZIP、预览和事务恢复设施，按最终选择状态校验所有依赖，最后接入多月 UI。

**Tech Stack:** Python、Flask、SQLAlchemy、Alembic、SQLite/MySQL、React、TypeScript、Vitest、pytest。沿用项目依赖，不为本功能引入任务队列或另一套 ORM。

**Spec:** `docs/design/2026-10-09-monthly-backup-design.md`（必须一起阅读）

## Global Constraints

- 导出月份多选；所有内容默认勾选，包括账号、密码哈希和权限。
- 导入识别月份及类别，支持部分恢复；未选月份和类别不变。
- 新增默认新增、冲突默认采用备份、系统独有默认不保留，可批量改为保留。
- 删除默认只对明确包含、完整覆盖、已选择的范围成立。
- 完整当前资料与历史月份隔离；历史结果不能随当前资料恢复漂移。
- 账号哈希不得出现在预览、日志和审计中；权限使用业务编号重新映射。
- 多月恢复统一事务；锁定规则沿用现有要求；跨月及年度影响必须明示。
- 不读取或输出 .env、数据库密码、钉钉密钥等凭证；不自动操作生产数据库。
- 当前本文件是实施方案，不是执行记录，不得声称其中测试已经通过。
- 文件名为拟定新增位置；修改现有代码前重新定位行号，避免按旧行号机械替换。
- 每阶段结束记录变更、实际验证命令和结果、遗留限制；用户未要求时不推送、不创建 PR。

## Review Focus

1. 旧包没有某类别与完整类别为空必须区分，阶段 4/7 用缺失类别与空类别对照测试。
2. 保留子记录却移除父资料不能产生悬空引用，阶段 7/8 验证最终依赖状态。
3. 当前操作者被恢复、全部管理员被移除，阶段 3/8 验证登录失效与管理员可用性。
4. 同月类别共享快照与跨月单据重叠，阶段 2/6/7 验证去重和未选类别稳定。
5. 多月写入失败、文件仍被其他月份引用，阶段 8 验证事务及文件生命周期。

## 新对话执行说明

先读设计文档，再读本计划和仓库 AGENTS.md。用户授权实施后按 0→10 顺序推进，不再重复询问已确认的需求。先检查 Git 状态，保护用户已有更改；需要隔离时使用项目规定的 worktree 流程。仅在发现本方案不能满足的数据事实或新的产品取舍时提出具体问题。

本方案涉及历史查询、账号认证和菜票恢复；不能以先改按钮名称替代这些前置阶段。用户希望分对话实施时，每次完成一个阶段，更新本文件对应复选框和执行记录，下一对话从最早未完成阶段继续。

文档中的接口是新功能约定，不表示这些函数已存在。测试片段为目标行为示例，阶段实施时用现有 fixture 建立真实数据，禁止 mock 被测恢复流程来制造通过结果。

## 共同接口约定

新建 `services/backup_document.py`，用 TypedDict 或项目现有类型习惯表达下面 JSON 契约，不引入复杂类层级。

```python
# NormalizedBackup 根结构
{
    "format_version": 2,
    "source_format_version": 1,  # 或 2
    "months": ["2026-06", "2026-07"],
    "coverage": {"shared/employees": {"included": True, "complete": False}},
    "shared": {},
    "monthly": {},  # month -> account_set / datasets / snapshots
    "cross_month": {},
    "annual": {},
    "_files": {},
}
# RestoreSelection
{
    "months": ["2026-06"],
    "categories": ["attendance", "employees"],
    "cross_month_keys": [],
    "annual_keys": [],
}
```

统一内部 scope 使用 `shared/<dataset>`、`month/<YYYY-MM>/<dataset>`、`cross_month/<dataset>`、`year/<YYYY>/<dataset>`。coverage 按 scope 登记，不只按用户大类别登记；备份未包含的 scope 不伪装为空。

拟定对外服务接口：

```python
normalize_backup(document: dict) -> dict
missing_backup_coverage() -> list[str]
can_delete_scope(coverage: dict, selected: bool) -> bool
collect_multi_backup(account_set_ids: list[int], categories: list[str], progress=None) -> dict
export_multi_backup(account_set_ids: list[int], categories: list[str], progress=None) -> bytes
build_multi_preview(document: dict, selection: dict, choices: dict | None = None) -> dict
restore_multi_backup(document: dict, selection: dict, choices: dict,
                     fingerprint: str, operator_id: int) -> dict
```

后三个核心模块分别放在现有 backup_service、restore_service；若大小明显超过可维护范围，再按“文档读取/选择校验/执行”拆文件，不做无关重构。现有单月入口作为兼容适配器保留，先不直接改变旧调用的返回字段。

---

## 阶段 0：建立基线与数据范围清单

**Files:** 阅读 `services/account_set_backup_schema.py`、`services/account_set_backup_service.py`、`services/account_set_restore_service.py`、`models/`、`routes/query_core.py`、`services/manager_attendance_service.py`、`services/migration_service.py`、现有备份/菜票/认证测试；修改本计划执行记录。

- [x] 检查 Git 状态、实际解释器和测试配置，不打印实际连接凭证。
- [x] 将 ORM 表/字段逐一归入设计类别或说明排除理由，尤其检查账号头像文件、授权表、备份审计和业务临时状态。
- [x] 定位所有历史查询/导出/计算读取当前基础资料的调用点，记录到执行记录，包含查询权限与当前离职过滤。
- [x] 运行以下基线，在记录里保存真正结果；失败先判定是否已有问题，不把新功能实现混入基线修复。

```bash
python -m pytest tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q
```

前端工作目录 `frontend/`：

```bash
npm test -- src/components/admin/AccountSetBackupModal.test.tsx
```

**验收：** 清单能解释每个业务表和外键如何备份，基线结果有记录。阶段 0 不操作生产数据库。

## 阶段 1：建立快照与当前有效状态模型

**Files:** 新增 `models/monthly_reference_snapshot.py`、`services/monthly_reference_service.py`、`tests/test_monthly_reference_snapshot.py`；修改 `models/__init__.py`、`models/employee.py`、`models/department.py`、`models/shift.py`、`services/migration_service.py`；新增 Alembic 迁移（以当时唯一 revision 命名，不预先假定 head）。

**Interfaces:** `ensure_month_reference(month: str) -> None` 只创建缺失快照；`get_month_reference(month: str, kind: str, business_key: str) -> dict | None` 返回历史 payload；`scan_legacy_month_references() -> dict` 只读报告。

- [x] 先写当前部门改变后快照不变、重复采集不覆盖已有快照的失败测试。

```python
def test_snapshot_is_not_refreshed_by_current_change(backup_app):
    from models import db
    from models.department import Department
    from services.monthly_reference_service import ensure_month_reference, get_month_reference
    ensure_month_reference("2026-06")
    before = get_month_reference("2026-06", "employee", "E1")
    Department.query.filter_by(dept_no="D1").one().dept_name = "新部门名称"
    db.session.commit()
    ensure_month_reference("2026-06")
    assert get_month_reference("2026-06", "employee", "E1") == before
```

- [x] 运行该测试确认因缺少快照能力失败，再实现唯一约束、payload、来源/质量及版本。
- [x] 基础资料增加明确有效状态，默认现有行有效；不得借用离职日期或锁定状态。
- [x] 加入仅扫描旧数据的报告入口；历史补齐按可证资料/基线标记区分，重复写入幂等，不在模型迁移里自动重算历史。
- [x] 更新初始化及整库迁移表清单，测试 SQLite 迁移和 MySQL 方言 DDL；没有真实 MySQL 时写明验证限制。

```bash
python -m pytest tests/test_monthly_reference_snapshot.py tests/test_migration_service.py -q
```

**验收：** 基础资料可退出当前集合而不删除历史外键；快照可查询、可追溯来源，不宣称基线等于真实过去。

## 阶段 2：历史读取、计算与资料维护接入快照

**Files:** 修改 `routes/query_core.py`、`routes/admin_core.py`、`routes/admin_imports.py`、`services/attendance_service.py`、`services/attendance_summary_service.py`、`services/manager_attendance_service.py`、`services/meal_ticket_service.py`、实际历史报表调用点；扩展 `tests/test_monthly_reference_snapshot.py`、`tests/test_manager_attendance_service.py`、`tests/test_attendance_summary_service.py`。

- [x] 先写集成失败测试：同一人员 6 月生产部、7 月仓储部；更新当前姓名、部门、人员类型和离职状态后，两月原查询、汇总、导出与重算结果稳定。
- [x] 测试历史人员集合不能因为当前离职被过滤；账号当前权限仍生效，不冻结旧权限。
- [x] 用统一月度读取服务替换历史业务对当前资料的依赖；新业务/当前维护查询只返回有效资料。
- [x] 导入、同步建立新月份时形成快照；明确的月内资料修正只改该月。不得在每次查询时用当前资料覆盖快照。
- [x] 同月恢复某类别引发快照变化会影响未选类别时，显示冲突并要求明确选择；实现与阶段 7 的校验契约一致。
- [x] 验证旧月份缺少可证快照时显示来源/质量限制，不能静默伪造可信历史。

```bash
python -m pytest tests/test_monthly_reference_snapshot.py tests/test_manager_attendance_service.py tests/test_attendance_summary_service.py tests/test_attendance_calendar_api.py -q
```

**验收：** 历史保护覆盖展示、成员集合、权限筛选、汇总、下载和计算，而不是仅姓名标签。此阶段通过前不开放共享资料默认移除。

## 阶段 3：账号恢复所需状态与令牌撤销

**Files:** 修改 `models/user.py`、`routes/auth_helpers.py`、`routes/api_auth.py`、`routes/admin_accounts.py`、`models/account_set_backup_restore.py`；新增迁移及 `tests/test_backup_account_state.py`；扩展 `tests/test_api_auth.py`。

**Interfaces:** `User.auth_version` 本地递增整数；JWT 包含版本，认证要求匹配。退出当前有效集合独立于临时失败锁定；历史操作者不物理删除。

- [x] 先写旧 token 在 auth_version 增加后拒绝、新登录 token 成功的失败测试；同时覆盖归档账号不能登录。
- [x] 增加有效账号状态及 auth_version；现存 token 无版本按版本 0 兼容，账号发生恢复变更后旧 token 失效。继续保留原 token 过期与签名验证。
- [x] 增加审计操作者用户名快照和多月任务标识；旧审计可读，迁移不删除历史。
- [x] 账号权限字段、profile_dept_id、人员/部门授权在阶段 4 登记，临时登录失败计数等明确排除。
- [x] 用真实密码哈希验证恢复后密码可登录，不将 auth_version 当作可导入字段。

```bash
python -m pytest tests/test_api_auth.py tests/test_backup_account_state.py -q
```

**验收：** 账号恢复可以撤销旧登录，归档账号保留审计身份，旧用户 ID 不复用。

## 阶段 4：注册表、覆盖检查与格式兼容

**Files:** 新增 `services/backup_document.py`、`tests/test_backup_document.py`、`tests/test_backup_coverage.py`；修改 `services/account_set_backup_schema.py`、`services/account_set_backup_service.py`、`AGENTS.md`。

- [x] 先写旧包、缺失类别、空完整类别、未知高版本的失败测试。

```python
def test_incomplete_scope_never_allows_missing_deletion():
    from services.backup_document import can_delete_scope
    assert not can_delete_scope({"included": False, "complete": False}, True)
    assert not can_delete_scope({"included": True, "complete": False}, True)
    assert can_delete_scope({"included": True, "complete": True}, True)
    assert not can_delete_scope({"included": True, "complete": True}, False)
```

- [x] 编写 normalize_backup，将 v1 单月及关联资料转换成不完整共享范围；缺失数据集保留 absent 标记，禁止在读取过程中补空后宣称完整。
- [x] 显式登记用户、授权关系、月度快照及各业务字段；本地 ID 和文件路径用引用转换，不能直接迁移。
- [x] missing_backup_coverage 遍历全部 ORM 表/字段，返回既未映射也未明确排除的条目；写新增字段和新增表时会失败的测试，不能 mock 该函数结果。

```python
def test_every_model_and_field_has_a_backup_decision():
    from services.backup_document import missing_backup_coverage
    assert missing_backup_coverage() == []
```

- [x] 保存一个固定 v1 测试包作为兼容 fixture；保留已支持的 legacy manager_stats、overtime、员工菜票豁免字段转换，不依赖现在的 exporter 生成所谓旧包。
- [x] AGENTS.md 加入设计文档 5.2 的同步开发要求，执行覆盖检查进入现有测试流程。

```bash
python -m pytest tests/test_backup_document.py tests/test_backup_coverage.py tests/test_account_set_backup.py -q
```

**验收：** 旧包安全读取；未知版本明确拒绝；新增业务数据遗漏能够被测试发现。

## 阶段 5：完整共享资料与账号序列化

**Files:** 修改 `services/account_set_backup_schema.py`、`services/account_set_backup_service.py`、`services/backup_document.py`；新增 `tests/test_backup_shared_data.py`。

- [x] 先写没有当月业务记录的人员、空部门、未分配班次也被导出的失败测试。
- [x] 写源/目标自增 ID 不同、username/emp_no/dept_no 相同的账号与授权映射测试。
- [x] 实现完整共享集合采集，保留在职/离职/归档业务状态；部门父链、默认班次和账号授权使用自然键引用。
- [x] 测试账号密码值是原哈希，没有明文；头像若属于账号可恢复资料则文件进入清单，没有本地路径外泄。
- [x] 预览密码差异返回布尔标记，检查整个预览 JSON 不含 password_hash 内容。

```bash
python -m pytest tests/test_backup_shared_data.py tests/test_backup_account_state.py -q
```

**验收：** 导出的是当前完整资料，账号权限可跨库映射，密码不会出现在预览中。

## 阶段 6：多月份 ZIP 导出

**Files:** 修改 `services/account_set_backup_service.py`、`services/account_set_export_progress_service.py`、`routes/admin_backups.py`；新增 `tests/test_multi_month_backup.py`；扩展现有 API/进度测试。

**Interfaces:** collect_multi_backup/export_multi_backup 使用共同接口。新建 POST `/api/admin/backups/export`，JSON 为 `{account_set_ids, categories, export_token}`；进度 GET `/api/admin/backups/export/progress?export_token=...`，按任务与当前用户绑定。原单月 GET 保留原契约。

- [x] 先写两月归档、共享资料一份、跨月单据一份、年度同键一份和文件去重的失败测试。
- [x] 实现 v2 文件结构，manifest 含 coverage/版本/校验清单；去重不丢来源关系。
- [x] 测试导出中任一所选月或共享资料变动时不能返回混合时间点备份。
- [x] 测试非法/重复月份、未知类别、缺失源文件、大小限制与当前用户进度归属。
- [x] 进度覆盖全部月份读取、文件打包、全范围校验及下载；不使用模拟增长冒充实际进度。

```bash
python -m pytest tests/test_multi_month_backup.py tests/test_account_set_backup_api.py tests/test_account_set_export_progress.py -q
```

**验收：** 两个月份导出后读取为统一文档，完整范围有证据，单月旧入口仍可使用。

## 阶段 7：多月差异与最终依赖校验

**Files:** 修改 `services/account_set_restore_service.py`；新增 `tests/test_multi_month_restore_preview.py`；扩展菜票测试。

**Interfaces:** build_multi_preview 返回 token 附加前的 `{months, coverage, rows, summary, blockers, fingerprint}`；rows 带 scope/month/year/category/status/default_choice/enabled/affected_months，密码使用专门的遮蔽差异字段。

- [x] 先写新增/冲突/系统独有默认 backup、一致不变、未选类别禁用的失败测试。
- [x] 对照测试 v2 空完整资料可移除、v1 子集不移除无关资料、缺失新类别不删除目标。
- [x] 用所有最终 choices 计算最终状态，校验父部门、人员、班次、卡号、账号授权和快照关联；移除父项保留子项必须返回明确 blocker。
- [x] 菜票按批次/明细/交易/冲正检查最终关系；测试完整替换允许、不一致核算拼接阻止、交易删除留下冲正阻止。
- [x] 年度资料影响列表按实际年份计算，不把所有账套无差别列为同一影响；跨月单据用实际起止月份。
- [x] 锁定月份有实际变更时阻止；未改变锁定月不因备份存在就阻止。
- [x] 目标指纹包含实际参与恢复和依赖的状态、文件及账号授权/版本；预览接口零写入。

```bash
python -m pytest tests/test_multi_month_restore_preview.py tests/test_account_set_restore.py tests/test_meal_tickets.py tests/test_meal_ledgers.py -q
```

**验收：** 所有默认规则成立；每个 blocker 能指出用户需调整哪些选择；不偷偷选择依赖或扩展恢复月份。

## 阶段 8：原子恢复、账号与文件生命周期

**Files:** 修改 `services/account_set_restore_service.py`、`routes/admin_backups.py`、`models/account_set_backup_restore.py`；新增 `tests/test_multi_month_restore.py`，扩展账号/原文件测试。

**Interfaces:** restore_multi_backup 使用共同接口；结果 `{task_id, months, counts, category_counts, warnings, reauthentication_required}`。新入口 POST `/api/admin/backups/preview`，POST `/api/admin/backups/<token>/preview`，POST `/api/admin/backups/<token>/restore`，DELETE `/api/admin/backups/<token>`；保留原 `/account-set-backups/` 路径的 v1 适配行为。

- [x] 先写两月恢复只选一月、一月失败全部回滚、文件写入失败回滚的集成失败测试。
- [x] 实现统一锁及事务，确认前再次生成预览、检查指纹和最终依赖；不循环调用多个会 commit 的旧 restore_backup。
- [x] 基础资料系统独有退出有效集合；月度业务记录按依赖顺序删除；未选类别及历史快照不变。
- [x] 新增更新按父先子后、删除子先父后；覆盖卡号互换、父部门重排、账号关联映射。
- [x] 菜票恢复只改本地数据，不调用外部充值/扣款设备；保留幂等键，测试恢复后再次业务请求不会重复计款。
- [x] 账号恢复检查最终至少一个可登录管理员；当前操作者可退出但审计持久、结果先返回、随后要求重新登录。
- [x] 文件成功前不清理旧文件；提交后只清理已无引用文件；被未选月引用的文件保留。
- [x] 校验他人任务、过期任务、重复确认、预览后目标变动，以及恢复失败没有部分审计成功记录。

```bash
python -m pytest tests/test_multi_month_restore.py tests/test_backup_account_state.py tests/test_account_set_backup_api.py tests/test_account_set_restore.py -q
```

**验收：** 多月/共享/账号全部成功或全部回滚，未选数据及文件不变，恢复后权限和登录行为符合设计。

## 阶段 9：月份多选、类别与差异多选界面

**Files:** 修改 `frontend/src/pages/admin/AdminDashboardPage.tsx`、`frontend/src/api/accountSetBackup.ts`、`frontend/src/components/admin/AccountSetBackupModal.tsx`、所属现有 CSS；新增 `frontend/src/components/admin/MonthlyBackupExportModal.tsx` 及测试；扩展 `AccountSetBackupModal.test.tsx`、`frontend/src/App.smoke.test.tsx`。

- [x] 先写多月勾选和所有导出类别默认勾选的失败测试，包含账号选项。
- [x] 导出弹窗显示所选月份、完整当前资料说明和包大小限制，调用新 API；保留实际阶段进度。
- [x] 导入先显示识别出的月份/类别/完整性/快照质量，允许选择部分范围；不完整范围解释无法按缺失删除的原因。
- [x] 差异界面提供月份/类别/状态/关键词筛选、行勾选、筛选结果全选和批量操作；勾选集合与 choices 分开，取消勾选不意外重置已有选择。
- [x] 测试筛选后批量只修改明确选择行，隐藏已选行有数量提示，new/system_only/changed 均可批量处理。
- [x] 所有菜票类别有中文标签，密码只显示一致/不同，用户流程不出现原始字段键和哈希。
- [x] 确认页显示移除当前资料与删除业务记录的区别，列出跨月/年度影响及依赖 blocker。
- [x] 恢复成功重新加载月份/业务缓存；账号需要重新登录时先显示恢复结果，再引导登录。失败保留可调整的选择。

前端工作目录 `frontend/`：

```bash
npm test -- src/components/admin/MonthlyBackupExportModal.test.tsx src/components/admin/AccountSetBackupModal.test.tsx src/App.smoke.test.tsx
npm run build
```

**验收：** 用户能完成“选多月导出 → 只选部分月/内容导入 → 筛选多选差异 → 确认恢复”，不需要逐条点完所有记录。

## 阶段 10：完整验证、使用说明与交接

**状态：** 自动化验证、说明与交接完成；隔离真实浏览器恢复、MySQL 8.0.46 迁移/并发及限定规模验证已补验；目标环境和更广压力验证仍保留限制，见阶段 10 执行记录。勾选仅表示本节列出的工作已有证据或明确限制记录，不表示生产验收签收。

**Files:** 修改 `README.md`、本计划执行记录；新增 `docs/monthly-backup-user-guide.md`（界面完成后按实际文案编写）。

- [x] 设计文档 11 的十个验收场景都有真实测试或明确的人工验证记录，验证至少两个月、跨年和源/目标 ID 不同。
- [x] 隔离测试数据库验证升级、v1→统一格式、v2 导出→空库恢复、部分恢复；不得拿生产库做恢复实验。
- [x] 验证新业务字段未登记时覆盖测试会失败，以及旧包 absent 类别不会误删。
- [x] 运行后端全套、前端全套和构建，记录实际命令与结果。已有失败、缺环境、未连真实 MySQL 均明确注明，不能称全部通过。

```bash
# 禁用 .env，只运行隔离 tests/；不要执行根目录 test_api.py
PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q
PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_backup_coverage.py -q
```

前端工作目录 `frontend/`：

```bash
npm test
npm run build
```

- [x] 检查差异只涉及本功能和必要历史隔离，检查迁移 head 与整库迁移清单。

```bash
git diff --check
git status --short
```

- [x] README 更新真实入口、完整资料范围、版本兼容、默认删除含义、账号重新登录、快照质量及文件限制。
- [x] 新增用户指南包含导出/导入步骤、选择依赖提示、旧包不可删除的说明、恢复结果和失败处理。
- [x] 最后记录完成阶段、未完成项、测试和部署所需迁移命令；生产数据库升级/部署另按用户授权执行。

**验收：** 核心场景通过、兼容性有固定旧包证据、文档与界面一致，迁移/部署限制写清楚。

## 执行记录模板

每阶段完成后在此追加，不把计划勾选当作验证证据：

```text
阶段：
完成日期：
工作分支/目录：
实际修改文件：
数据/接口决策与设计偏差：
失败测试证据：
验证命令及结果：
未验证环境或剩余限制：
下一个阶段：
```

## 实际执行记录：阶段 0

- 完成日期：2026-10-09。工作目录：`/Users/lewis/Lewis/code/git/MTEmpHub`；分支 `master`。
- 初始 Git 只有设计、计划两份未跟踪文档；按用户指定目录原地顺序实施，保护既有内容；未 reset、stash、checkout、提交、推送、部署或操作生产数据库。
- 新增 [数据范围与历史读取清单](2026-10-09-monthly-backup-inventory.md)：原有全部 33 个 ORM 表逐字段记录 v1 映射、v2 待登记及排除理由、外键、头像/任务文件边界、阶段 2 历史读取与权限接入点。原整库迁移缺项单独记录，没有混入阶段 1。
- 实际解释器：`.venv-mac/bin/python`（Python 3.9.6）；shell 没有 `python`，首次计划原命令没有启动测试，随后改用该解释器。
- 基线：`.venv-mac/bin/python -m pytest tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q` → **37 passed in 4.29s**。
- 前端：`cd frontend && npm test -- src/components/admin/AccountSetBackupModal.test.tsx` → **6 passed**。
- 阶段 0 只盘点，无新增生产行为，所以不人为新增失败测试；失败测试从阶段 1 开始。清单不代替阶段 4 自动覆盖门禁。
- 下一阶段：1。

## 实际执行记录：阶段 1

- 完成日期：2026-10-09。目录和分支同阶段 0；全部改动保留在工作区，未提交、推送、部署、操作生产数据库或派发子代理。
- 新增 `models/monthly_reference_snapshot.py`、`services/monthly_reference_service.py`、`migrations/versions/20261009_monthly_references.py`、`tests/test_monthly_reference_snapshot.py`。
- 修改 `models/__init__.py`、`models/employee.py`、`models/department.py`、`models/shift.py`、`services/migration_service.py`、`tests/test_migration_service.py`。为补齐真实初始化/命令入口，额外修改 `app.py`、`services/bootstrap_service.py`；更新 `tests/test_overtime_migration.py` 的最新 head 预期。设计文档原内容未改。
- 模型：month/kind/business_key 联合唯一；payload 以部门/班次业务编号引用，不依赖可变当前行；保留 provenance、quality、schema_version 和时间。人员 payload 包含全部统计来源、管理/菜票/哺乳标记、离职和有效状态及默认班次；部门 payload 包含父部门编号，班次包含时段与跨日标记。
- `ensure_month_reference` 只写缺失键，不覆盖已有 verified/partial/baseline 快照；读取返回深拷贝；采集由调用者提交或回滚。当前全部人员/部门/班次（含退出当前集合但历史仍引用的行）只作为 baseline，不能据此宣称旧月份成员集合已准确恢复。
- `scan_legacy_month_references` 不写入，也不 autoflush 待提交修改；报告账套及已有月度业务月份、缺失快照、日报/月报原始身份字段与菜票身份候选、来源和冲突。原始 XLSX 仅列为 `not_inspected`；可证候选仍待阶段 2 明确核对，不自动选当前值或标为已还原历史。
- 已有 verified/partial 快照会原样保留。扫描候选与当前 baseline 分开；显式采集命令只创建 baseline，完整档案核对/可信字段写入属于阶段 2 接入工作，不把这部分提前宣称完成。
- 人员/部门/班次 `is_active` 独立于 resigned_at/is_locked，默认旧行有效。退出有效集合只更新状态；测试验证日报外键与本地 ID 保留，重新启用复用原行。当前维护/业务筛选尚待阶段 2 接入。
- 明确入口（仅在 fixture 测试中执行）：`flask --app manage scan-month-references`；`flask --app manage capture-month-references --month 2026-06 --month 2026-07`。多月采集先校验所有月份，统一提交；不会通过查询、应用创建或模型迁移自动采集/重算旧月份。
- Alembic：原 head `20261009_meal_rules` → 唯一新 head `20261009_month_refs`。真实部署升级命令为 `flask --app manage db upgrade`，本次未对真实数据库执行。`upgrade-legacy-schema` 的兼容路径同时补表及有效状态；整库迁移清单加入新快照表。
- RED 证据：首轮快照测试 **12 failed**，均因模型/服务尚不存在；CLI 测试在入口不存在时 **1 failed / 16 passed**；旧库兼容补字段前测试 **1 failed / 2 passed**（缺 employees.is_active）。移除转移清单中的快照表做进程内回归验证时，转移测试按预期因没有快照转移结果失败，正常清单恢复后通过。
- 中间实现修正：Python 3.9 类型注解补 `from __future__ import annotations`；测试追加位置缩进错误已在收集阶段纠正。未把这些错误当作业务 RED 证据。
- 指定阶段命令：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_monthly_reference_snapshot.py tests/test_migration_service.py -q` → **18 passed**。
- 相关兼容回归：`.venv-mac/bin/python -m pytest tests/test_monthly_reference_snapshot.py tests/test_migration_service.py tests/test_overtime_migration.py tests/test_app_bootstrap.py -q` → **47 passed in 2.46s**；早期备份/菜票迁移相关组合 **56 passed**。
- 首轮全量：**637 passed / 6 failed**，失败均为 `test_overtime_upgrade_after_legacy_schema_patch` 的六个参数组合硬编码旧 head；数据库已升到新 head，随后更新该预期并重跑全量。
- 最终后端全量：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest --ignore=test_api.py -q` → **644 passed in 221.76s**。禁用 dotenv 加载以避免真实配置；根目录 `test_api.py` 是导入即向本机服务发送真实登录请求的演示脚本，不属于隔离单元测试，故明确排除，其余全部收集测试均运行。
- 前端全量：`cd frontend && npm test` → **52 files / 443 tests passed**。
- 验证边界：SQLite 升级/重复升级/回退、create_all 已建新表时升级、legacy 先补后迁移已验证；MySQL 只验证真实方言 DDL 生成及采用 MySQL 标识规则的本地 SQLite 转移，没有连接真实 MySQL。
- 自行审查：依用户要求未派发审查代理；审查发现并修复旧库兼容入口和旧 head 预期。未进入阶段 2—10，历史查询/权限/导出/计算仍需接入快照；共享资料恢复默认移除尚未开放，v1 行为未改变。
- 收尾：`git diff --check` 通过；Git 仍为 `master`，本次代码、迁移、测试及清单/执行记录留在工作区，原有设计文档保留。没有新增凭证文件或更改生产数据。
- 交接：下一次从最早未完成的 **阶段 2** 开始，先读本记录与 [清单](2026-10-09-monthly-backup-inventory.md)，不要重复实现阶段 0/1；保护本次未提交改动。

## 实际执行记录：阶段 2

- 完成日期：2026-10-09。工作目录仍为 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`。开始时已核实阶段 1 的模型、迁移、服务及其未提交更改；保留全部既有内容，按用户要求本人顺序实施，无子代理、worktree、stash、reset、提交、推送、部署或生产数据库操作。
- 本阶段修改：`services/monthly_reference_service.py`、`attendance_source_service.py`、`manager_attendance_service.py`、`meal_ticket_service.py`、`late_offset_service.py`、`import_service.py`、卡/钉钉同步服务；`routes/query_core.py`、`api_query.py`、`api_admin.py`、`admin_core.py`、`admin_imports.py`、`admin_attendance_overrides.py`；前端查询 bootstrap API、月度候选刷新 hook、查询/修正/迟到冲抵页面和日历质量提示。新增 `tests/test_monthly_reference_integration.py` 与 hook 测试，扩展日历提示测试；更新本计划与清单。AttendanceService/批量汇总沿用已经接入的统一 attendance views，无需改动相邻计算公式。阶段 1 的模型/迁移改动仍在同一工作区，不计为本阶段新实施内容。
- 统一读取服务使用月度人员/部门树/班次/类型/离职与有效状态/统计口径；本地 ID 仅用于现有业务记录及当前授权。6/7 月资料互相隔离，当前资料变化不改历史成员、姓名、部门、计算和导出。授权依旧使用当前账号的实时赋权/撤权。已保存年度统计展示身份按所选月解析，年度数据范围仍由后续阶段登记。
- 当前维护、bootstrap 和基础资料导出只列有效候选；创建/重导入相同退出编号复用原行。历史引用绑定阻止物理删除、批量删除及空部门清理绕过保护。新月份导入/同步在其业务事务内形成基线；旧月重导入既不刷新快照，也不吸纳后来入职人员。历史外部同步与重算入口采用冻结的来源开关，各人员计算口径按月独立。
- 资料修正采用显式 CLI 最小入口，不新增备份 UI：`correct-month-reference` 仅改指定月；`reconcile-month-evidence` 只接受只读扫描的确切候选，保存字段来源且整体保持 `partial`。`scan-month-references --inspect-archives` 可只读核对归档 XLSX 的姓名/部门候选，冲突不自动裁决。所有入口均仅用 fixture runner 验证，未运行用户数据库命令。
- 阶段 7 契约：`reference_change_blockers(month, proposed, selected_categories)` 的 proposed 元素为 `{kind, business_key, payload}`，检查已有考勤（含修正）及菜票批次共享资料；冲突返回 month/key、required_categories、affected_months、reason，要求明确一并选择，绝不自动补选类别/月份。修正和核对命令已调用此契约并检查月份锁。后续恢复预览/执行需按最终选择状态调用；尚未开放共享资料默认退出/多月恢复功能。
- 新产品取舍：已向用户询问历史绑定编号能否改动，交接时尚未收到答复；等待超过一分钟后已明示可逆假设并实施推荐保护：已关联快照的人员/部门/班次编号修改返回 409。姓名、当前归属和其他资料仍可编辑。若用户需要改编号，应另设计稳定映射/迁移，不能直接改业务键让历史断链；此项不宣称已经获得用户确认。
- RED 证据：首先新增两月身份/成员/权限/下载/计算/旧月质量集成测试，得到 6 个真实行为失败（当前资料覆盖历史、离职人员被排除、权限树依赖当前归属及缺少质量提示）；后续新增导入、修正、来源、保护、bootstrap 测试均先运行失败再实现。前端月份缓存测试首先失败为七月返回六月候选。首次后端全套得到 649 passed / 10 failed，定位并修复了纯计算临时对象无 Flask context 及无快照旧数据离职兼容过滤；前端全套发现初始化清空候选导致链接带入查询失败，修复为仅切换月份清空。未修改既有测试预期来掩盖回归。
- 验证命令及真实结果（全部禁用 dotenv，pytest 使用内存/临时 SQLite fixture）：
  - 基线：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_monthly_reference_snapshot.py tests/test_manager_attendance_service.py tests/test_attendance_summary_service.py tests/test_attendance_calendar_api.py -q`：96 passed。
  - 最终阶段验收：上述命令额外包含 `tests/test_monthly_reference_integration.py`：133 passed in 24.18s；新增集成文件单独运行：37 passed in 1.43s。
  - 后端全套：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q`：681 passed in 240.64s。与阶段 1 相同，只运行 `tests/`；根目录 `test_api.py` 是真实服务/网络登录示例，未执行。
  - `frontend/` 内 `npm test`：53 files、446 tests passed（13.56s）；`npm run build`：成功。构建仍有既有大 chunk 提示，没有进行无关拆包。
  - `git diff --check`：通过；重新检查 `git status --short`，仍保留阶段 1 与本阶段的未提交更改。
- 环境与剩余限制：未连接真实 MySQL、卡设备或钉钉，外部同步只用假客户端；没有生产迁移/升级。旧月份未核对/采集时仍以兼容读取返回明确 missing 警告；基线/部分资料在日历显示质量限制，不宣称恢复了真实过去。部署需要先升级阶段 1 模型，再只读核对旧月并显式采集/选取证据；后续开启基础资料恢复必须守住这一前置条件。原 v1 包缺少快照/类别的 absent 语义和默认删除行为留给阶段 4/7/8，不在本阶段改变。
- 下一个阶段：阶段 3（账号有效状态、auth_version、JWT 撤销、审计身份）。本次按用户要求完成阶段 2 即交接，不继续阶段 3。

## 实际执行记录：阶段 3

- 完成日期：2026-10-09。工作目录仍为 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`。开始时核实并保留阶段 0–2 的全部未提交更改；本人顺序实施，无子代理、worktree、stash、reset、提交、推送、部署或生产数据库操作。另存开始时已跟踪文件 diff 至临时文件用于核对，未把旧工作区替换为 HEAD。
- 本阶段修改：`models/user.py`、`routes/auth_helpers.py`、`routes/api_auth.py`、`routes/admin_accounts.py`、`models/account_set_backup_restore.py`、`services/account_set_restore_service.py`、`services/bootstrap_service.py`、`tests/test_api_auth.py`、`tests/test_overtime_migration.py`、范围清单与本计划；新增 `migrations/versions/20261009_backup_account_state.py`、`tests/test_backup_account_state.py`。没有修改前端和阶段 2 历史读取行为。
- 账号状态：独立 `is_active` 默认 true，`auth_version` 默认 0；新 JWT 携带本地版本，认证同时校验有效状态和严格整数版本。旧 JWT 无版本仅按 0 兼容；递增本地版本后 cookie/Bearer 旧登录均失效，新登录使用新版本；原 HS256 签名及到期验证保留。`User.revoke_tokens()` 仅递增本地版本；`archive()` 退出集合并撤销旧登录，不提交事务，供阶段 8 原子恢复调用。没有为密码/权限编辑增加隐式 ORM 监听器。
- 数据/接口决定：现有单个/批量账号删除改为退出当前账号集合，保留原 ID、username 和授权关系，保护历史操作者身份及避免 ID 重用；当前账号及失败锁定列表只列有效账号，管理员数量保护排除归档账号，解锁不重新激活归档账号。保留 username 意味着普通新建不能使用已归档用户名；后续恢复按同 username 找回原行，这是设计 3.2 的身份保留要求，不新加账号重新激活界面。
- 审计：新增 nullable `operator_username` 快照和带索引 `task_id`；现有单月恢复为每次任务生成唯一 UUID 并保存操作者用户名，后续改名/退出集合不会改写快照。旧审计只按当前仍可找到的用户回填缺失快照，不能宣称这是操作发生时的历史用户名；旧 `task_id` 保留 NULL，不伪造旧任务分组。阶段 8 多月任务复用一次任务标识，并补充月份/类别/影响范围摘要。
- 迁移：revision `20261009_account_state` 接在 `20261009_month_refs` 后，SQLite 存量行保留、默认状态兼容、重复升级和 legacy-bootstrap→Alembic 均有真实临时库验证；`upgrade-legacy-schema` 也补齐字段、索引及缺失审计快照。Alembic 只读脚本检查确认唯一 head 为 `20261009_account_state`。整库迁移已有 users 全列搬运，本阶段未改其表顺序；阶段 0 已记录的旧审计表覆盖限制未顺手修复。
- 字段决策已写入范围清单：账号权限、profile_dept_id 和人员/部门授权按业务键登记；`is_active` 属于可备份业务状态，`auth_version` 属于目标本地撤销状态，登录失败次数/临时锁定时间明确排除。真正的覆盖注册表留给阶段 4；真实密码哈希直接赋回账号后，通过真实登录接口验证备份密码可用、旧密码不可用，不重复哈希。不宣称阶段 3 已提供账号包导入/恢复入口。
- RED 证据：新增阶段测试首先得到 15 个预期失败，覆盖旧 token 未撤销、无版本 token 未按目标版本拒绝、归档账号仍可登录/改密、缺少本地撤销能力、单个/批量删除导致身份丢失、缺少审计快照/任务标识、旧库升级未提供新状态、非法版本未拒绝。补充原签名/到期的回归保护及 MySQL 方言编译检查。首次实现后的阶段验证为 39 passed / 2 failed：构造旧库 fixture 未先删除 task_id 索引，修正测试准备后迁移验证通过。扩展验证首次为 96 passed / 3 failed：旧库局部表 fixture 没有 users 表，审计回填直接查询导致失败；按表存在条件保护回填后既有三个测试 RED→GREEN，没有修改其断言。最终代码稳定前启动的全套运行已主动中止，不计为验证结果；最终代码稳定后重新运行，首次后端全套为 692 passed / 6 failed（249.65s）：六个加班迁移测试的字段/迁移断言均通过，但最终版本仍硬编码为阶段 1 head；同步到本阶段新 head `20261009_account_state`，不改业务断言，重跑全套。
- 验证命令及实际结果（全部 `PYTHON_DOTENV_DISABLED=1`，pytest 使用内存/临时 SQLite）：
  - 基线：`.venv-mac/bin/python -m pytest tests/test_api_auth.py tests/test_account_set_restore.py tests/test_api_admin.py -q`：71 passed in 34.34s。
  - 阶段验收：`.venv-mac/bin/python -m pytest tests/test_api_auth.py tests/test_backup_account_state.py -q`：42 passed in 28.41s。
  - 扩展验收：上述阶段验收加 `tests/test_account_set_restore.py tests/test_app_bootstrap.py tests/test_monthly_reference_snapshot.py tests/test_migration_service.py`：100 passed in 30.93s。
  - head 断言同步后的定向回归：`.venv-mac/bin/python -m pytest tests/test_overtime_migration.py tests/test_api_auth.py tests/test_backup_account_state.py -q`：48 passed in 27.07s。
  - 最终后端全套：`.venv-mac/bin/python -m pytest tests -q`：698 passed in 245.32s（4:05），退出码 0。
  - `git diff --check`：通过；最终 `git status --short` 保留阶段 0–3 的未提交更改，仅新增本阶段约定文件，没有部署/推送。
- 工作区保护核对：逐文件比较开始时的 33 份既有 tracked diff，在忽略 diff 对象哈希并还原唯一必要的加班 head 断言后均完全一致；另行复核 bootstrap 原阶段 1/2 块完整保留、新增仅本阶段字段及审计兼容逻辑。
- 自行复核：按 code-review 技能检查阶段 3 差异、迁移默认/幂等/旧审计保留、cookie/Bearer 与归档状态、哈希未进入响应或审计；未派发审查代理。后续阶段仍需独立验证最终管理员可登录性和当前操作者恢复后结果先返回再重新登录。
- 环境与剩余限制：没有真实 MySQL 连接，仅 SQL 方言编译；没有生产迁移/升级。前端没有改动，本次不重复前端全套。根目录 `test_api.py` 是真实服务/网络登录示例，沿用阶段 1/2 的 `pytest tests` 范围，不执行。阶段 4/5/8 必须确保 auth_version 永远不从包导入，恢复修改过的账号在同一事务中本地递增，且至少保留一个可登录管理员。阶段 3 不开放基础资料恢复，不改变旧包 missing/absent 语义。
- 下一个阶段：阶段 4（注册表、覆盖检查与格式兼容）。本次按用户要求阶段 3 验收后交接，不继续阶段 4。

## 新对话可直接粘贴的提示词

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md

核心需求已经确认。按计划从最早未完成阶段开始，先核实已有代码和 Git 状态，保护现有更改。
采用你自己顺序实施的方式，不自动派发子代理。
每阶段先写有意义的失败测试，再最小实现、验证、更新复选框和执行记录。
默认导出全部内容；冲突默认采用备份；完整所选范围的系统独有默认不保留。
必须先完成历史资料隔离，再开放基础资料恢复；旧包缺失类别不能作为空类别删除。
不要操作生产数据库、部署或推送。发现新的关键产品取舍时再问我，不重复询问已确认需求。
阶段 0、阶段 1、阶段 2、阶段 3、阶段 4 和阶段 5 已完成，实际结果见执行记录。本次从阶段 6 开始，完成该阶段后记录结果并交接，不继续阶段 7；后续按顺序继续。
```

## 实际执行记录：阶段 4

- 完成日期：2026-10-09。按用户要求在 `/Users/lewis/Lewis/code/git/MTEmpHub` 的 `master` 工作区顺序实施，保留阶段 0–3 未提交更改；无子代理、worktree、stash、reset、提交、推送、部署或生产数据库操作。开始时保存 tracked diff 至 `/tmp/monthly-backup-stage4-before.patch`；逐块比较 41 份既有 diff 全部一致。
- 本阶段修改 `services/account_set_backup_schema.py`、`services/account_set_backup_service.py`、`AGENTS.md`、本计划；新增 `services/backup_document.py`、`tests/test_backup_document.py`、`tests/test_backup_coverage.py`、固定 `tests/fixtures/monthly_backup/legacy-v1.zip` 及说明。`AGENTS.md` 已被仓库既有忽略规则忽略，本次仍按要求更新本地文件，未修改忽略规则或强行加入 Git。
- 注册表：保留 v1 DATASETS/collector/restorer，新增独立 V2_DATASETS、V2_REFS、FILE_REFS、类别/数据集版本/删除策略与逐字段排除理由。登记当前有效状态、账号原哈希、长期禁用、页面权限、创建时间、profile 部门与两种授权、月度快照及已有业务字段。员工、部门、班次、账号退出当前集合；授权/分配关系按完整选择范围移除。源 ID 转为 emp_no/dept_no/shift_no/username/account_month；原文件和头像转为私有文件引用。auth_version 永不映射，临时失败次数/锁定时间明确排除；恢复审计/来源映射、消息、安装级配置逐字段解释，新增字段不会被整表排除吞掉。
- 覆盖检查：`missing_backup_coverage()` 导入 models 下所有模型模块，仅检查 ORM metadata，不读业务库；返回未登记表名和 table.field。真实 metadata 添加员工字段、已排除消息表字段、全新表的测试均能发现遗漏，测试后清理自身临时 metadata。该测试随现有 `pytest tests` 自动执行；AGENTS.md 增加导出、预览、恢复、依赖、版本兼容及覆盖门禁同步要求。
- 统一文档：`normalize_backup` 不修改传入文档；v1 按原始 datasets 建 coverage，再调用既有字段校验/legacy 转换，校验用补空列表不进入输出范围。v1 关联共享、跨月和年度为 included=true/complete=false；账号、快照、原包缺失数据集为 included=false/complete=false。只有已包含且完整且明确选择的 scope 才通过 `can_delete_scope`。显式空完整 v2 与旧包缺失有对照验证。v1 未包含的 is_active/账号/快照不伪造；下游须依据 source_format_version 和实际字段处理兼容，不能把旧包补造为完整当前资料。
- 读取适配决定（Ruling）：`read_backup(payload)` 保留旧单月返回契约；`read_backup(payload, normalized=True)` 返回 v1/v2 的统一文档。旧恢复入口明确拒绝 v2，避免在阶段 7/8 的选择和原子执行完成前接入。代价：后续多月入口必须显式采用 normalized=True；不能把统一文档传给旧单月恢复函数。
- v2 codec 契约：manifest 的 files 列出所有 JSON/归档成员的 path/size/sha256；shared.json、months/<month>.json、cross_month.json、annual.json 是业务成员，coverage、months、dataset_versions 在 manifest。账套块携带 month，基于本地 account_set_id 的引用输出 account_month；头像为 avatar_file_key/avatar_sha256/avatar_size（无头像三者皆 null）。未声明的已存在 scope 保守视为不完整；与真实内容矛盾的 included/complete 声明拒绝。数据集/快照未知版本、源 ID/auth_version、非法类型、重复业务键、月份/年度范围错误拒绝。继续复用上传/成员/解压限制、路径/符号链接检查；清单和行级文件引用均校验摘要与长度，拒绝漏列、多列、重复声明、未引用归档及业务摘要不符。此阶段只提供读取，不实现 v2 导出或业务恢复。
- 固定 v1 fixture 是手工编写的合成旧包，不通过当前 exporter 生成；包含旧员工菜票豁免缺省、manager_stats 来源字段缺省、overtime 手工/撤销字段缺省，缺少菜票数据集、账号与快照。旧单月读取及统一读取均验证这些转换；包内无真实密码或文件。
- RED→GREEN：首轮 13 failed，原因是缺失 normalize/coverage/注册表及 normalized 读取能力；最小实现后 28 passed。v2 字段/ZIP 扩展首次 7 failed/13 passed（缺少字段/版本校验、v2 reader）；实现后 39 passed。补充月份块/0000 年范围首次 2 failed/24 passed；修复后 67 个定向回归通过。自行复核添加畸形月份列表首次 1 failed/28 passed，堆栈证明 set(months) 先于类型校验，调整顺序后通过。账号创建时间按阶段 0 清单保留的测试首次 1 failed/29 passed，登记可备份字段后通过。原有安全检查已能拒绝的案例作为回归保护，不声称其首次失败。
- 验证（全部设置 `PYTHON_DOTENV_DISABLED=1`；数据库测试使用内存/临时 SQLite）：
  - 基线 `.venv-mac/bin/python -m pytest tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q`：37 passed in 4.45s。
  - 最终定向 `.venv-mac/bin/python -m pytest tests/test_backup_document.py tests/test_backup_coverage.py tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q`：72 passed in 4.23s。
  - 最终后端全套 `.venv-mac/bin/python -m pytest tests -q`：733 passed in 214.05s（3:34），退出码 0。复核修正前启动的首轮全套为 728 passed in 222.48s；最终结论使用修正后重新启动的 733 测试结果。
  - `git diff --check`：收尾重新检查通过。
- 自行按 code-review 技能复核注册表、absent/empty、旧接口兼容、成员/行级摘要和历史/账号边界；按用户要求不派发审查代理。没有新增产品取舍、没有改变已有冲突默认/删除执行，也没有开放基础资料恢复。后续阶段 5 实现完整共享采集/账号序列化和哈希脱敏；阶段 6 按本次 codec 契约导出，阶段 7/8 才执行最终依赖、历史隔离前置条件、管理员可登录性和多月事务检查。
- 下一阶段：阶段 5。本次阶段 4 验证完成后交接，不继续阶段 5；前端无改动，不重复前端全套；根目录 test_api.py 是真实服务登录示例，沿用已确认 `pytest tests` 范围，不执行。


## 实际执行记录：阶段 5

- 完成日期：2026-10-09。按用户要求在 `/Users/lewis/Lewis/code/git/MTEmpHub` 的 `master` 工作区本人顺序实施，保护阶段 0–4 全部未提交更改；没有子代理、worktree、stash、reset、提交、推送、部署或生产数据库操作。开始时保存 tracked diff 至 `/tmp/monthly-backup-stage5-before.patch`，同时保存既有 tracked/untracked 文件内容摘要用于收尾核对。
- 本阶段修改：`services/account_set_backup_service.py`、`services/account_set_backup_schema.py`、`services/backup_document.py` 与本计划；新增 `tests/test_backup_shared_data.py`。没有更改 ORM、迁移、前端、认证或恢复执行入口。
- 完整共享采集接口：`collect_shared_backup()` 返回 `{shared, coverage, _files}`，默认采集全部七个共享数据集（部门、人员、班次、人员默认班次、账号、人员授权、部门授权），不依赖月份或该月业务成员；包含在职/离职及归档状态。空完整集合仍明确声明 included=true/complete=true。共享列表按自然键排序；父部门、所属部门、班次、profile 部门和账号授权均按业务键输出；缺失引用及循环部门父链阻止采集。批量加载引用，避免每条授权逐一查询源记录。
- 账号序列化保留原 `password_hash`、角色、原始页面权限、有效状态、长期禁用状态/原因和创建时间，密码不重新哈希、不保存明文；`profile_emp_no` 原本就是业务编号。源 ID、目标本地 auth_version 和临时登录失败/锁定字段不输出。测试在同一临时 SQLite fixture 重建目标库，使用完全不同的 ID 验证相同 username/emp_no/dept_no/shift_no 的目标解析；真实密码校验确认原哈希仍接受原密码。
- 目标映射契约：`resolve_shared_references(name, row)` 只读返回 `{目标外键字段: 本地ID}`，允许解析归档父资料，缺失目标具体报告业务键字段，不偷偷补建资料、不导入源 ID。阶段 8 必须在最终选择依赖校验及明确恢复父资料之后调用，实际写入、令牌撤销、管理员保护和事务执行仍由阶段 7/8 完成。
- 头像：上传头像从配置的 uploads/avatars 目录读取，输出 `avatar_file_key=files/<SHA-256>`、摘要及长度，文件字节进入 `_files`，不输出源 URL/文件名/绝对路径；相同内容可共享引用，拒绝缺失文件、非法路径及符号链接，遵守单文件与累计大小限制。现有 v2 reader 的清单/行级校验可完整读回这些字节，测试手工构造 ZIP 验证，没有实现阶段 6 exporter。
- Ruling：现有账号头像还包括 `default:` 内置选择器，使用注册表明确登记的可选 `avatar_preset` 保存，且与文件引用互斥；缺少该可选字段的既有 v2 行保持原形，不补造字段、不提升数据集版本。理由：内置头像不是文件，直接转空会丢失账号资料；代价：阶段 8 头像恢复必须同时处理 preset 和上传文件，并在目标生成可用的本地头像 URL。
- 脱敏预览契约：`shared_preview_row(name, system, backup, coverage=..., selected=...)` 返回稳定 `row_key`、四种差异、脱敏 system/backup 和字段差异；密码只返回 `password_changed` 布尔标记，整个行 JSON 不包含 password_hash 字段或任一侧哈希值，输入行不被修改。新增/冲突默认 backup，一致默认 system；系统独有只有明确 included/complete/selected 时默认 backup，否则 system。该接口供阶段 7 多月预览使用，本阶段没有新增预览 API，也未改变旧单月预览默认策略或开放基础资料恢复。
- RED→GREEN：首轮 13 个失败证明缺失完整采集、目标引用解析和脱敏差异接口；补充完整所选范围门禁后 16 个预期失败。最小实现首次 49 passed/2 failed，原因是两个测试按源 ID 顺序取列表下标，而采集按业务键排序；改为按 dept_no 查找，保持原业务断言。自行按 code-review 技能复核后添加部门循环与累计头像限制测试，首次 22 passed/2 failed（未拒绝），分别增加父链检查和去重文件累计字节检查后通过。头像读取/符号链接、内置 selector 校验和空完整范围等已由实现满足的补充测试只记回归验证，不宣称首轮失败。
- 验证命令与实际结果（均设置 `PYTHON_DOTENV_DISABLED=1`，数据库测试仅使用内存/临时 SQLite）：
  - 基线：`.venv-mac/bin/python -m pytest tests/test_backup_document.py tests/test_backup_coverage.py tests/test_account_set_backup.py -q`：50 passed in 0.52s。
  - 最终定向：`.venv-mac/bin/python -m pytest tests/test_backup_shared_data.py tests/test_backup_account_state.py tests/test_backup_document.py tests/test_backup_coverage.py tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q`：112 passed in 17.47s，含新增共享数据文件 24 个测试及 ORM 覆盖检查。
  - 最终后端全套：`.venv-mac/bin/python -m pytest tests -q`：757 passed in 224.21s（3:44），退出码 0。
  - `git diff --check`：通过。逐文件摘要核对确认只有三个预定服务文件被改动；对这些文件去除本阶段新增块/字段后，内容摘要与开始时完全一致。其他阶段 tracked diff 和 untracked 文件均保留；本计划仅更新阶段 5 勾选、未来交接提示及追加执行记录。
- 环境与剩余限制：没有真实 MySQL、生产迁移或设备连接，根目录 `test_api.py` 是真实服务登录示例，沿用已确认 `pytest tests` 范围不执行。前端无改动，不重复前端测试。旧单月 collect/export/read 默认契约不变；v1 缺失类别仍为 absent，不会变成空完整范围。阶段 6 要将共享结果采集一次并纳入全范围前后指纹/一致视图校验，不能把多份 v1 ZIP 拼接；阶段 7/8 仍须守住历史隔离、最终依赖、范围选择和账号恢复事务门禁。
- 下一阶段：阶段 6（多月份 ZIP 导出）。本次按用户要求完成阶段 5 后交接，没有实施阶段 6。

## 阶段 6 工作提示词（可直接复制）

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md

核心需求已经确认。按计划从最早未完成阶段开始，先核实已有代码和 Git 状态，保护现有更改。
采用你自己顺序实施的方式，不自动派发子代理。
每阶段先写有意义的失败测试，再最小实现、验证、更新复选框和执行记录。
默认导出全部内容；冲突默认采用备份；完整所选范围的系统独有默认不保留。
必须先完成历史资料隔离，再开放基础资料恢复；旧包缺失类别不能作为空类别删除。
不要操作生产数据库、部署或推送。发现新的关键产品取舍时再问我，不重复询问已确认需求。

阶段 0、阶段 1、阶段 2、阶段 3、阶段 4 和阶段 5 已完成，实际结果见执行记录。本次从阶段 6 开始，完成该阶段后记录结果并交接，不继续阶段 7；后续按顺序继续。

阶段 5 已完成完整共享资料与账号序列化、目标业务键解析和脱敏差异接口。最终定向测试 112 通过，后端全套 757 通过。已有更改仍未提交，请保护工作区。
collect_shared_backup() 返回 {shared, coverage, _files}，包含完整部门、人员、班次、默认班次、账号及两种授权，保留离职/归档状态；账号保留原密码哈希，不导出 auth_version 或临时登录锁定字段。
上传头像通过 avatar_file_key/avatar_sha256/avatar_size 引用 _files 中的字节；内置头像通过可选 avatar_preset 保存，与上传文件引用互斥。既有 v2 行缺少 avatar_preset 时保持兼容。
read_backup(payload) 保留旧单月契约；read_backup(payload, normalized=True) 返回统一文档。现有恢复入口仍拒绝 v2，尚未开放基础资料恢复。

阶段 6 应按计划完成多月份 ZIP 导出，复用现有注册表、共享采集和 v2 reader 契约：
- 实现 collect_multi_backup/export_multi_backup，以及 POST /api/admin/backups/export 和按当前用户绑定的导出进度接口；保留原单月 GET 契约。
- 默认导出全部类别，支持明确取消；manifest 包含月份、coverage、数据集版本和文件校验清单。
- 验证两个月份归档、共享资料仅一份、跨月/年度同键去重、文件内容去重及头像引用；取消的类别不得声明为空完整范围。
- 导出必须来自一致数据库视图或经过全范围前后指纹验证，覆盖全部所选月份及共享资料，不能拼接独立 v1 包。
- 验证非法/重复月份、未知类别、缺失源文件、大小限制及进度归属；进度反映实际读取、打包、校验和下载，不模拟增长。
- 运行阶段定向测试、tests/test_backup_coverage.py 和后端现有全套，测试禁用 dotenv 并使用内存/临时数据库；根目录 test_api.py 是真实服务登录示例，不执行。

完成后更新阶段 6 复选框和执行记录，并在文档最下方追加阶段 7 的可复制工作提示词。本次不实施阶段 7 的差异预览或阶段 8 的恢复执行。
```


## 实际执行记录：阶段 6

- 完成日期：2026-10-09。在指定 `master` 工作区本人顺序实施，保留阶段 0–5 未提交更改；无子代理、worktree、stash、reset、提交、推送、部署或生产数据库操作。开始保存 tracked diff 至 `/tmp/monthly-backup-stage6-before.patch`，并保存既有 modified/untracked 文件摘要至 `/tmp/monthly-backup-stage6-hashes.json`。
- 本阶段修改：`services/account_set_backup_service.py`、`services/account_set_export_progress_service.py`、`routes/admin_backups.py`、`tests/test_account_set_export_progress.py` 与本计划；新增 `tests/test_multi_month_backup.py`。未改 ORM、注册表、统一 reader、恢复执行、迁移或前端。
- 新增 `collect_multi_backup(account_set_ids, categories=None, progress=None)` / `export_multi_backup(...)`，直接按 v2 注册表采集各范围，复用共享采集和原有业务行序列化，不拼接独立 v1 包。默认全部 11 个用户类别；显式 `[]` 导出月份清单和未包含范围；未知/重复类别、重复/非法/缺失账套、源月份无效均明确拒绝。月度业务自动携带已有历史快照，不新建或刷新快照；保留来源与质量限制。
- ZIP 为 manifest/shared/months/cross_month/annual/files 分离结构。manifest 包含排序后的月份、所选类别、coverage、数据集版本、实际配置的 build_id（缺省 null）、导出时间，以及全部业务 JSON/文件成员的字节数和 SHA-256。当前共享资料只采集一份；跨月按业务键合并，年度按年份查询一次且包含没有当月考勤的人员；原始文件与上传头像按内容摘要共享文件成员，保留各记录的业务来源、source_filename、account_month，以及跨月起止时间、年度业务键，不丢引用关系。头像仍属账号的必要资料，账号选中时携带其头像。
- Ruling：跨月单据只覆盖所选月份的并集，不代表全部全局单据，故 included=true/complete=false；年度按所选年份采集完整集合，可声明完整年份范围。原因是不能把未选月份独有单据伪装成缺失删除；阶段 7/8 仍须逐键明确选择跨月/年度恢复及实际影响范围。
- 类别取消：不读取被取消的共享集合/头像；取消 archives 同时排除文件数据集 imports/meal_imports/meal_ledger_imports 和依赖其原文件的 meal_import_rows，相应 coverage 为 included=false/complete=false。台账记录若仍引用 data.import_key，则明确提示补选归档类别，符合设计“取消依赖记录或提示补选”，不偷偷补选、不输出悬空引用。其他未包含类别从统一 normalizer 得到 absent 标记，绝不声明为空完整范围。
- 一致性：第一次全范围采集形成指纹，完成打包后 expire_all 清除 ORM 缓存，再次采集所有所选月份、完整所选共享、跨月、年度和文件内容，比较全范围指纹；数据或文件变化拒绝返回备份。对实际 ZIP 再调用既有 normalized v2 reader，核验全部清单、行级引用、格式、成员/解压大小。测试覆盖第二个月、共享部门、文件变化及通过 engine 独立提交的变化；所有文件仍遵守单文件/压缩包 100 MiB、总解压 500 MiB 和成员数限制，源文件读取中消失也转换为明确备份错误。
- 新 POST `/api/admin/backups/export` 接受 account_set_ids/categories/export_token；GET `/api/admin/backups/export/progress?export_token=...` 按当前用户和任务读取。export_token 可省略（直接下载）；提供时验证格式、拒绝复用，且与旧单月进度命名空间隔离。进度持久化在既有私有目录，包含所选 account_set_ids；使用同目录临时文件 + 原子硬链接创建任务，避免并发 worker 覆盖 owner；后续进度仍原子替换。
- 进度：读取按已读 scope/dataset 数、打包按实际写入字节、校验按实际重读范围加最后 ZIP 校验单元、下载按 WSGI 响应迭代发送的字节报告。不模拟增长；ZIP 真正校验后才显示校验 100%，响应迭代完成才 ready，中断为 failed。下载进度是服务端发送进度，不声称浏览器已保存到磁盘。原单月 GET 导出/进度契约保留。
- RED→GREEN：首轮新增 28 failed，证明缺少多月服务与 POST 路由；首轮实现 7 failed/58 passed，堆栈定位多余 monthly cross_month_keys 不属于阶段 4 reader 契约，移除该额外块并通过已有行的区间/来源保留关系后 28 passed。自行按 code-review 技能复核并补充测试，4 failed/35 passed 暴露校验提前 100%、进度缺少所选账套、下载中断未结束和并发 owner 覆盖；最小修复后扩大定向 151 passed。再补台账归档依赖及读取途中文件消失，先观察 2 failed，再修复，扩大定向 153 passed。快照、不同文件内容、外部提交及未选账号头像等已有实现满足的新增案例仅作为回归验证，不声称首次失败。
- 验证（所有 pytest 设置 `PYTHON_DOTENV_DISABLED=1`，只使用内存/临时 SQLite；根目录真实服务示例 `test_api.py` 不执行）：
  - 扩大定向：`.venv-mac/bin/python -m pytest tests/test_multi_month_backup.py tests/test_account_set_backup_api.py tests/test_account_set_export_progress.py tests/test_backup_shared_data.py tests/test_backup_account_state.py tests/test_backup_document.py tests/test_backup_coverage.py tests/test_account_set_backup.py tests/test_account_set_restore.py -q`：153 passed in 24.21s。
  - 计划定向及覆盖：`.venv-mac/bin/python -m pytest tests/test_multi_month_backup.py tests/test_account_set_backup_api.py tests/test_account_set_export_progress.py tests/test_backup_coverage.py -q`：51 passed in 9.03s。
  - 最终后端全套：`.venv-mac/bin/python -m pytest tests -q`：795 passed in 234.51s（3:54），退出码 0。最终两项边界修复之前启动的首轮全套为 793 passed in 232.14s；最终结论使用修复后重新运行的 795 结果。
  - 收尾 `git diff --check`：通过。既有 modified/untracked 文件摘要确认仅备份服务和本计划在原有更改基础上继续变化；去除本阶段新增函数、import 和共享类别/进度接入后，备份服务全文摘要与开始时完全一致。其他阶段全部既有文件保留；本计划仅勾选阶段 6 并追加执行记录及阶段 7 提示词。
- 限制及交接：没有真实 MySQL 验证；前端多选与浏览器消费新进度在阶段 9 接入。本阶段只新增导出，原恢复入口仍拒绝 v2，未开放基础资料恢复。本次阶段 6 验收后交接，不实施阶段 7 差异预览或阶段 8 恢复执行。

## 阶段 7 工作提示词（可直接复制）

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md

核心需求已经确认。先核实已有代码和 Git 状态，保护现有更改。
采用你自己顺序实施的方式，不自动派发子代理。
每阶段先写有意义的失败测试，再最小实现、验证、更新复选框和执行记录。
默认导出全部内容；冲突默认采用备份；完整所选范围的系统独有默认不保留。
必须先完成历史资料隔离，再开放基础资料恢复；旧包缺失类别不能作为空类别删除。
不要操作生产数据库、部署或推送。发现新的关键产品取舍时再问我，不重复询问已确认需求。

阶段 0–6 已完成，实际结果见执行记录。已有更改仍未提交，请保护工作区。
本次从阶段 7 开始，完成该阶段后记录结果并交接，不继续阶段 8；后续按顺序继续。
阶段 6 已实现 collect_multi_backup/export_multi_backup、POST /api/admin/backups/export 和用户归属进度，保留单月 GET。
默认导出全部类别，取消的范围为 absent；月度业务携带已有快照；跨月 coverage 不完整，年度为完整所选年份；文件与头像内容去重。
read_backup(payload, normalized=True) 返回统一文档；旧恢复入口仍拒绝 v2。
collect_shared_backup 保留原密码哈希及账号业务状态，不含 auth_version/临时登录锁定；shared_preview_row 仅返回脱敏密码差异；resolve_shared_references 解析目标业务键。

阶段 7 按计划完成多月差异和最终依赖校验：
- 实现 build_multi_preview(document, selection, choices=None)，返回 months/coverage/rows/summary/blockers/fingerprint；预览零写入。
- 新增/冲突默认 backup，一致 system；系统独有只有明确 included/complete/selected 才可默认移除；未选类别禁用。
- 对照 v2 空完整范围、v1 关联子集、旧包缺失类别，禁止误删。
- 按最终 choices 校验父部门、人员、班次、卡号、账号授权、月度共享快照及菜票批次/明细/交易/冲正关系；保留子项却移除父项要给具体 blocker。
- 快照变动影响同月未选类别时阻止隐式修改；保留历史来源与质量限制。
- 跨月/年度使用实际影响月份列表及明确条目选择；实际变更影响锁定月份时阻止。
- 目标指纹覆盖实际恢复和依赖范围、文件、账号授权/本地版本；密码哈希不进入 API、日志或审计。
- 运行计划定向测试、tests/test_backup_coverage.py 和后端现有全套；禁用 dotenv，仅用内存/临时数据库，不执行根目录 test_api.py。

完成后更新阶段 7 复选框和执行记录，并在文档最下方追加阶段 8 的可复制工作提示词。
本次不实施阶段 8 恢复执行、事务/文件落地或阶段 9 前端。
```

## 实际执行记录：阶段 7

- 完成日期：2026-10-09。目录 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`。保护阶段 0–6 及原有查询功能的全部未提交更改，原地本人顺序实施；无子代理、stash、reset、提交、推送、部署或生产数据库操作。
- 本阶段新增 `services/multi_month_restore_preview.py`、`tests/test_multi_month_restore_preview.py`；在 `services/account_set_restore_service.py` 末尾仅追加 `build_multi_preview` 服务入口，并更新本计划。旧单月预览/恢复和此前账号审计更改均保留；没有新增 ORM 字段、迁移、HTTP 预览/恢复入口或前端行为。
- 为避免将新多月校验继续塞入已有单月事务恢复文件，将只读预览及最终关系校验放入专门模块；这是计划允许的按职责拆分。菜票新增覆盖集中在新的多月预览测试文件，原菜票业务测试未改。
- 接口接受原始 v1、原生 v2 及 reader 返回的统一文档；统一 v1 重新通过冻结旧 codec 校验并重建 coverage，不允许抬高其删除完整性。返回 `{months, coverage, rows, summary, blockers, fingerprint}`，不创建 token、不写数据库或文件；`no_autoflush` 防止预览把调用者待提交对象写入。
- 行键为 `<scope>/<canonical business key>`（归档沿用既有业务键规则），行含 scope/month/year/category/status/default_choice/enabled/affected_months，并附最终 `choice`；月度行附 `reference_quality`。新增和冲突默认 backup，一致 system；系统独有仅在 included/complete/selected 同时成立时默认 backup。未选/absent 行禁用；无效行键、禁用范围 choices 和不完整范围删除明确拒绝。跨月与年度行必须另列入 `cross_month_keys` / `annual_keys`，不能只勾选大类别。
- 按全部最终 choices 模拟新增、覆盖、移除；当前资料移除按退出集合模拟，历史外键仍可绑定原本地行。检查当前父部门、部门循环、人员、班次、卡号（包含退出集合后仍占用的唯一卡号）、账号 profile 部门及两种授权；归档账号/人员自身携带的历史授权仍可保留，移除其父记录则给出具体 blocker。blocker 提供 row_key、required_rows，必要时补充 month/required_categories。
- 快照保留 payload/provenance/quality/schema_version；校验身份、父部门、默认班次、部门循环和月度业务引用。快照变动调用阶段 2 的共享消费者契约；类别或实际消费者数据集 absent 时，勾选类别也不能授权隐式修改。当前资料变化若影响未采集快照的历史成员列表、年度展示或缺少相关快照的历史引用，返回 `unisolated_history`，要求先显式核对补齐，不自动采集、不伪造可信历史。
- 菜票按最终批次、明细、补扣、交易、冲正、导入行及独立台账关系校验；完整一致替换允许，保留资金记录却切换核算来源、采用备份资金却混入目标独有历史、删除原交易留下冲正、跨明细或金额不匹配冲正、唯一请求/来源重复均阻止。恢复预览不调用设备或外部支付服务。
- 跨月区间按实际半开时间范围列月，年度只列该年份实际存在的目标账套月份；菜票同时列业务月、充值月及实际付款月。跨月台账归档按全局 key 匹配原目标记录，不误判为新增；归档改动影响未选月/类别的台账消费者时明确阻止。只有最终实际变更涉及的锁定月份产生 locked blocker，相同行和选择 system/skip 不因包内存在该月而阻止。
- 指纹使用本次检查的完整注册数据与依赖图，包含目标业务状态、文件实际摘要/大小、账号授权、本地 ID/auth_version、路径绑定及账套锁。采用保守的全图检查：无关目标更新也可能使预览失效，当前未进行按依赖裁剪或大数据性能优化。密码哈希仅参与私有比较/摘要，公开 system/backup/fields 不含哈希字段；新增/冲突/系统独有密码行均有脱敏测试。
- RED 证据：最初 **8 failed**，接口尚不存在；随后菜票替换/父子/冲正与充值月影响 **5 failed**；快照 absent 消费者、身份/循环、文件缺失和历史隔离 **6 failed**；跨月台账原归档、月底零点微秒和额外资金历史 **3 failed**；归档账号授权、部分 absent 数据集、未采集月新增成员/年度展示、新月缺账套、归档未选月消费者均先观察断言失败，再作最小实现。没有 mock 被测预览或最终状态校验。
- 验证命令均设置 `PYTHON_DOTENV_DISABLED=1`，数据库仅使用内存/临时 SQLite；根目录真实服务登录示例 `test_api.py` 未执行。
  - 最终定向：`.venv-mac/bin/python -m pytest tests/test_multi_month_restore_preview.py tests/test_account_set_restore.py tests/test_meal_tickets.py tests/test_meal_ledgers.py tests/test_backup_coverage.py -q` → **141 passed in 11.44s**，其中新预览文件 38 个测试。
  - 开发期间全套分别为 **825 passed in 231.84s**、**831 passed in 234.45s**、**833 passed in 237.17s**；它们不替代最后两项边界修正后的复验。
  - 最后两项边界修正后的后端全套：`.venv-mac/bin/python -m pytest tests -q` → **833 passed in 230.03s（3:50）**，退出码 0。阶段 7 据此完成勾选。
  - `git diff --check` 通过；Git 状态确认既有 modified/untracked 文件保留，本阶段仅增加上述模块/测试/入口/记录。附加 `py_compile` 尝试因 macOS 默认字节码缓存位于允许目录外而受限，未把它记为成功；真实 pytest 导入与定向回归已通过。
- 验证边界：没有连接真实 MySQL、升级真实数据库或部署。前端没有改动，未重复前端测试。阶段 8 的 HTTP/token 生命周期、原子事务、文件落地/清理、账号撤销及审计执行尚未实施；旧恢复入口仍拒绝 v2。
- 本次只完成阶段 7 后交接；下一阶段为阶段 8，不提前实施阶段 8/9。

## 阶段 8 工作提示词（可直接复制）

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 继续实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md（含阶段 7 实际执行记录）

核心需求已经确认。先核实已有代码和 Git 状态，保护全部未提交更改。
采用你自己顺序实施的方式，不自动派发子代理。
每阶段先写有意义的失败测试，再最小实现、验证、更新复选框和执行记录。
默认导出全部内容；冲突默认采用备份；完整所选范围的系统独有默认不保留。
必须保护历史资料隔离；旧包缺失类别不能作为空完整类别删除。
不要操作生产数据库、部署、提交或推送。只在发现新的关键产品取舍时询问，不重复询问已确认需求。

阶段 0–7 已完成，实际结果见执行记录。本次只实施阶段 8，完成后记录结果并交接，不继续阶段 9。
阶段 7 最终定向 141 个通过（含 38 个多月预览测试及 ORM 覆盖检查），后端全套 833 个通过。
已有更改仍未提交；原单月恢复仍保留，尚未开放 v2 恢复 HTTP 入口。

已有契约：
- read_backup(payload, normalized=True) 返回统一文档；build_multi_preview(document, selection, choices=None) 已在 account_set_restore_service 暴露，实现位于 multi_month_restore_preview.py。
- selection 为 {months, categories, cross_month_keys, annual_keys}；跨月/年度使用预览 row_key 明确选择，勾选大类别不自动选条目。
- rows 使用 <scope>/<canonical business key>，含 default_choice/enabled/affected_months/choice/reference_quality；choices 只传 row_key -> backup/system/skip，必须由服务端重建真实变更。
- 预览返回 {months, coverage, rows, summary, blockers, fingerprint}，零数据库和文件写入。密码哈希仅在私有文档中，不能从脱敏 public rows 构造账号写入内容。
- absent/incomplete/未选范围不能按缺失删除。当前资料退出有效集合并保留历史本地 ID；归档账号和人员原有历史授权可保留。
- 最终父子关系、卡号、授权、快照、菜票核算/资金/冲正/来源一致性及实际锁定月份均已校验；确认执行前必须重新生成预览并拒绝 blocker 和过期指纹。
- 当前资料不能改变未采集快照的旧月成员或年度展示。不得自动采集快照绕过 unisolated_history；baseline/partial 来源质量须保留。
- 跨月台账归档按全局业务 key 对应既有记录，可能自身 month 与月度容器不同；改动仍被未选月/类别引用的归档时必须拒绝，不扩展用户选择。
- 指纹当前采用保守完整目标/依赖图，含文件、授权、目标本地 ID/auth_version、路径和锁；确认前要读取新鲜状态，避免复用 ORM 缓存形成假指纹。

阶段 8 按计划完成：
- 先写只选一月、第二月失败整次回滚、文件写入失败回滚等真实集成失败测试。
- 实现 restore_multi_backup(document, selection, choices, fingerprint, operator_id)；统一锁与一个事务，不能循环调用会自行 commit 的旧 restore_backup。
- 按父先新增/更新、子先删除执行；基础资料退出当前集合，业务记录按依赖顺序移除，处理卡号互换、父部门重排及不同源/目标 ID 的授权映射。
- 菜票只恢复本地记录，保留幂等键与来源去重，不调用外部设备、不重放充值扣款。
- 校验最终至少一个可登录管理员；受影响账号递增本地 auth_version，不导入源版本。当前操作者可退出但审计保存 username 快照，结果先返回，再要求重新登录。
- 文件先私有暂存；失败撤销数据库并清理新文件，成功后只清理已无引用的旧文件，保护仍被未选月引用的文件。
- 接入 POST /api/admin/backups/preview、POST /api/admin/backups/<token>/preview、POST /api/admin/backups/<token>/restore、DELETE /api/admin/backups/<token>；保护任务归属、过期、重复确认、目标变动及失败审计，保留 v1 路径兼容。
- 运行阶段 8 定向测试、tests/test_backup_coverage.py 和后端 tests/ 全套；设置 PYTHON_DOTENV_DISABLED=1，只用内存/临时数据库，不执行根目录 test_api.py。

完成后更新阶段 8 复选框和执行记录，并在文档最下方追加阶段 9 可复制工作提示词。
本次不实施阶段 9 前端，不部署、不操作生产数据库。
```

## 实际执行记录：阶段 8

- 完成日期：2026-10-10。目录 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`。本人原地顺序实施，无子代理、stash、reset、提交、推送、部署或生产数据库操作；阶段 9 未实施。
- 开始前保存已有 tracked 更改补丁与 untracked 文件副本到 `/private/tmp/mtemphub-before-stage8.patch`、`/private/tmp/mtemphub-before-stage8-untracked.tar.gz`。结束前逐文件比对确认：阶段 8 指定修改范围之外的既有更改全部原样保留。
- 新增 `services/multi_month_restore.py`、`tests/test_multi_month_restore.py`、`tests/test_multi_month_restore_api.py`。修改现有 restore_service 服务入口及文件引用清理、multi_month_restore_preview 的私有执行上下文与管理员校验、admin_backups 路由及本计划；没有新增 ORM 字段或迁移。沿用阶段 3 的 task_id/operator_username/counts JSON 审计字段即可表达多月执行，不需要再更改模型。
- 执行入口 `restore_multi_backup(document, selection, choices, fingerprint, operator_id)` 返回 `{task_id, months, counts, category_counts, warnings, reauthentication_required}`；HTTP 内部可用仅关键字参数 `task_id=token` 把任务与持久审计绑定。公开 preview 返回字段保持阶段 7 契约，执行仅使用重新校验的私有原文，密码写入不从脱敏 public rows 重建。
- 复用 restore_lock；确认时 rollback/expire_all 清除先前 ORM 状态，SQLite BEGIN IMMEDIATE，其他方言对完整注册业务范围执行 FOR UPDATE。重新生成预览，拒绝指纹变化、依赖/锁定/历史隔离 blocker；全部月份、共享资料、账号和成功审计只提交一次，不循环调用旧 restore_backup。
- 基础资料系统独有只退出 is_active 集合，本地 ID、旧月快照和历史授权锚点保留。业务删除按显式依赖逆序；新部门先建立本地锚点再绑定最终父链。卡号先释放所选绑定再写最终状态，用户/人员/部门授权均按目标业务编号查询本地 ID。
- 菜票只写本地 ORM，保留 request_key/request_digest/source_key/冲正引用；不调用设备、外部支付或业务充值函数。临时父锚点和临时唯一键解决批次键替换、人员核算及请求键互换的中间约束，最终全部移除临时锚点，数据库 FK 检查保持开启。真实菜票请求重试测试验证已恢复请求不会再次计款。
- 跨月台账归档按全局业务 key 绑定原目标行，即使归档自身月份与所选容器、原目标月份不同仍复用本地 ID；仍被未选范围消费时继续由阶段 7 blocker 拒绝，不扩大选择。
- 账号或任一授权变动均使受影响账号本地 auth_version 递增一次，源版本不导入。实际变更的预览和执行最终均检查至少一个启用且未被长期禁用/临时登录锁定的管理员。保持无变更的归档资料只读比较兼容；执行仍检查最终管理员。当前操作者可以归档；审计保存原 username，HTTP 先返回结果与重新登录标记，下一请求由原认证版本检查拒绝。真实哈希恢复后使用备份密码可验证登录，事务失败仍保留原密码。
- 文件先写 private/staging；全部暂存成功后分配目标归档/头像路径。任何业务、文件、成功审计写入失败均撤销整个业务事务并清理新文件；旧文件在提交前不删。提交后清理日志查询全部归档及账号头像引用，仍被未选月份/其他账号引用的文件保留；提交后的清理异常只返回成功警告，不追加失败审计。
- 成功审计保存备份摘要、月份、selection、显式覆盖 choices、服务器最终 choices、每类别计数、实际影响月份及退出当前资料行；没有密码内容。失败在业务 rollback 后独立写入 status=failed 审计，不生成部分成功记录，不输出数据库异常参数。沿用月字段存首个所选月，完整月份保存在 counts JSON 内。
- 四个入口已接入：POST `/api/admin/backups/preview` 上传，POST `/api/admin/backups/<token>/preview` 重新比较，POST `/api/admin/backups/<token>/restore` 确认，DELETE `/api/admin/backups/<token>` 取消。上传支持 v1/v2，返回 token、selection 和预览；默认选择实际 included 类别，跨月/年度 keys 为空，需明确逐条选择。后两个 POST 的 JSON 为 `{selection, choices}` / `{selection, choices, fingerprint}`。保持原单月路径与返回契约。
- 任务继续使用原归属、TTL、任务文件锁；非法范围 400、过期/他人/已处理任务拒绝、目标变化 409。成功审计以 token 为 task_id，提交后 metadata/ZIP 清理失败仍返回成功警告；即使缺少新任务 metadata format 标记，持久审计也拒绝重复确认。
- 旧包 absent/incomplete 范围沿用原覆盖规则，不能按缺失删除当前资料或新类别；旧 account-scoped 行使用原单月容器绑定本地账套，未给旧 codec 添造字段。baseline/partial 快照 payload/provenance/quality/schema_version 原样保存，未选月不变；未自动采集快照绕过 unisolated_history。
- RED 证据：首批只选一月、第二月失败、文件暂存失败 **3 failed**（恢复入口缺失）；共享头像引用清理 **1 failed**；FK 开启的批次键替换、请求键互换、临时锁定管理员 **3 failed**；跨月归档全局绑定及台账必填请求键 **2 failed**；最后管理员预览/非法请求失败审计分别先观察断言失败；来源重导出 **1 failed**、提交后清理异常 **1 failed**、默认 included 类别 **1 failed**、缺旧任务 format 标记仍防重复 **1 failed**；v1 厂休/原文件实际写入 **2 failed**，再逐项作最小修正。测试准备中补注册 SystemSetting 和显式建立测试快照；未放宽生产校验让夹具通过。
- 所有命令设置 `PYTHON_DOTENV_DISABLED=1`；只使用内存/临时 SQLite 与临时文件，不执行根目录 `test_api.py`。最终定向命令：
  `.venv-mac/bin/python -m pytest tests/test_multi_month_restore.py tests/test_multi_month_restore_api.py tests/test_multi_month_restore_preview.py tests/test_backup_account_state.py tests/test_account_set_backup_api.py tests/test_account_set_restore.py tests/test_backup_coverage.py -q` → **114 passed in 20.86s**，含阶段 8 新增 25 个执行集成测试、8 个 HTTP 场景。
- 中间后端全套 `.venv-mac/bin/python -m pytest tests -q` → **863 passed in 247.48s**；此运行不包含后续旧任务标记和 v1 实际写入修正，不作为最终完成依据。
- 旧任务标记修正后的中间全套：**864 passed in 252.36s**，仍不包含最后 v1 写入修正。
- 最后 v1 写入修正后的最终后端全套：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q` → **866 passed in 244.34s（4:04）**，退出码 0，无警告或失败。阶段 8 据此全部勾选。
- `git diff --check` 已通过。验证边界：没有连接真实 MySQL、没有执行真实迁移/升级、没有运行前端测试或构建；本次不实施阶段 9。MySQL 真实并发/文件权限与大数据性能仍需在后续隔离环境验证。
- 下一阶段：9，前端月份多选、内容选择、差异多选和确认界面；阶段 9/10 复选框保持未完成。

## 阶段 9 工作提示词（可直接复制）

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 继续实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md（含阶段 8 实际执行记录）

核心需求已经确认。先核实已有代码和 Git 状态，保护全部未提交更改。
采用你自己顺序实施的方式，不自动派发子代理。
每阶段先写有意义的失败测试，再最小实现、验证、更新复选框和执行记录。
默认导出全部内容；冲突默认采用备份；完整所选范围的系统独有默认不保留。
历史资料隔离、旧包 absent/incomplete 不误删必须保留。
不要操作生产数据库、部署、提交或推送。只在发现新的关键产品取舍时询问，不重复询问已确认需求。

阶段 0–8 已完成，实际结果见执行记录；已有更改仍未提交。
本次只实施阶段 9，完成后记录结果并交接，不继续阶段 10。

已有后端契约：
- POST /api/admin/backups/export，JSON {account_set_ids, categories, export_token}；默认全部类别（含账号），进度 GET /api/admin/backups/export/progress?export_token=...，按任务和当前用户绑定。
- POST /api/admin/backups/preview 使用 multipart file，支持 v1/v2，返回 {token, selection, months, coverage, rows, summary, blockers, fingerprint}。
- selection = {months, categories, cross_month_keys, annual_keys}；上传默认实际 included 类别；跨月/年度 keys 默认空，必须用预览 row_key 明确选择，勾选大类别不自动选条目。
- POST /api/admin/backups/<token>/preview，JSON {selection, choices}；POST /api/admin/backups/<token>/restore，JSON {selection, choices, fingerprint}；DELETE /api/admin/backups/<token> 取消。
- rows 使用 <scope>/<canonical business key>，含 month/year/category/status/default_choice/enabled/affected_months/choice/reference_quality；choices 只传 row_key -> backup/system/skip，实际变更由服务端重建。
- new/changed 默认 backup；system_only 仅完整 included 且已选范围默认 backup；same 默认 system。absent/incomplete 禁止按缺失删除，未选行禁用。
- 密码只提供 password_changed 布尔差异，不返回哈希；不要新增原始字段键/哈希展示。
- blockers 已检查历史隔离、快照消费者、最终父子/卡号/授权、菜票资金/冲正/来源、实际锁定月份和最后管理员。不可在前端绕过或偷偷扩展选择。
- 指纹采用保守完整目标/依赖图；恢复时清理 ORM 缓存、重新生成预览，目标变化返回 409，应引导重新比较。
- 成功结果 {task_id, months, counts, category_counts, warnings, reauthentication_required}。当前资料移除是退出有效集合、保留本地 ID；业务移除是删除记录。确认页先从预览区分这两者。
- 成功需先展示结果及 warnings，再按 reauthentication_required 引导重新登录；原账号 auth_version 变化会使下一认证请求返回 401。先处理恢复结果，避免立刻加载业务导致结果消失。
- 恢复使用统一锁和一个事务，只改本地菜票数据，不重放设备/充值；文件失败全回滚，成功清理仅限无引用旧文件。
- 他人/过期/已处理任务拒绝；成功审计防重复确认。失败业务全部回滚，任务可重新预览调整选择重试。原 /account-set-backups/ 单月入口保留兼容。

阶段 9 按计划完成：
- 先写月份多选、全部导出类别默认勾选（包括账号）的前端失败测试。
- 实现导出弹窗，展示完整当前资料说明、包大小限制及真实阶段进度。
- 导入显示月份、实际类别、included/complete、快照来源质量；允许选择部分月份/类别，解释旧包不可按缺失删除。
- 差异提供月份/类别/状态/关键词筛选、单行勾选、筛选结果全选、多选和批量 backup/system/skip；勾选集合与 choices 分开，隐藏已选行有数量提示。
- 逐条明确选择跨月/年度 row_key，显示实际影响月份；全部菜票类别有中文标签；不把原始字段键当作用户文案。
- 确认页显示新增/更新/退出当前资料/删除业务记录、跨月影响和具体 blocker；失败保留可调整选择。
- 成功刷新月份/业务缓存；需要重新登录时先显示结果再引导登录。
- 在 frontend/ 运行计划定向测试和 npm run build；运行必要前端回归，记录实际命令与结果。需要跑后端测试时设置 PYTHON_DOTENV_DISABLED=1，只用测试数据库，不执行根目录 test_api.py。

完成后更新阶段 9 复选框和执行记录，在文档最下方追加阶段 10 可复制工作提示词。
本次不实施阶段 10，不部署、不操作生产数据库、提交或推送。
```


## 实际执行记录：阶段 9

- 完成日期：2026-10-10（本次环境日期）。目录 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`。按用户指定原地顺序实施；无子代理、stash、reset、提交、推送、部署、生产数据库操作。仅完成阶段 9，阶段 10 保持未勾选。
- 开始前保存 tracked 二进制补丁到 `/private/tmp/mtemphub-before-stage9.patch`，保存 untracked 副本到 `/private/tmp/mtemphub-before-stage9-untracked.tar.gz`；70 个既有变更文件的校验值保存在 `/private/tmp/mtemphub-before-stage9-hashes.json`。结束前逐文件比对，除本计划执行记录外，既有未提交变更均原样保留。
- 修改 `frontend/src/api/accountSetBackup.ts`、`frontend/src/components/admin/AccountSetBackupModal.tsx`、`frontend/src/pages/admin/AdminDashboardPage.tsx` 和 `account-center.css`；新增 `MonthlyBackupExportModal.tsx`、`backupLabels.ts`，更新/新增相应组件、API 及 App smoke 测试。不改后端业务代码、ORM、迁移或历史读取逻辑。
- 导出：账套设置入口打开多月弹窗，预选当前月份，支持多月勾选；全部 11 个类别默认选中，包括账号、密码及权限。显示完整当前资料、月度快照说明和 100 MiB 上传限制。POST 新导出接口，按 export_token 轮询新进度接口，保留真实收集/打包/验证阶段及实际下载字节进度；忙碌时禁止重复下载，完成状态留在弹窗。
- 导入：上传 v1/v2 走新 `/api/admin/backups/preview`；保留拖放、文件格式/单文件检查，新增大小检查。初始范围沿用服务器实际 included 类别和月份，跨月/年度 keys 不自行补选；范围变动后仍保留备份可选月份。覆盖清单展示各数据集 included/complete/absent/incomplete，解释旧包子集和缺失范围不能按缺失删除。每行业务显示备份/系统快照质量，快照行显示来源中文说明。
- 差异：月份/类别/状态/编号或姓名关键词筛选；行勾选、当前筛选结果全选、取消全部勾选、对明确所选行批量 backup/system/skip。批量勾选集合与 choices 独立；取消勾选不重置 choices，隐藏已勾选行显示数量。仅禁用范围变动后已不属于所选范围的 choices，避免服务器拒绝非法行选择。不完整范围的系统独有记录不能通过批量采用备份提交缺失删除。
- 跨月/年度：必须逐条勾选“恢复条目”，将原始 server row_key 写入 cross_month_keys/annual_keys；大类别勾选不自动选条目。展示实际影响月份及全年影响，菜票充值跨月也进入确认清单。所有菜票数据集均有中文标签。
- 文案与性能：字段名、依赖提示、权限及常见值使用中文；结构化资料按中文项目展示，不直接 stringify 原始字段键；密码仅显示一致/不同，摘要/哈希内容不展示。差异每批渲染 100 行，筛选全选仍覆盖全部匹配可用行；字段表仅在展开时创建。
- 确认：分别计数新增、更新、退出当前资料、删除业务记录，列出两种移除清单及跨月/年度影响。具体 blocker 与所需依赖记录同时显示于比较和确认页；有 blocker 可以查看确认，但不能执行恢复。不会自动补选、扩大范围或绕过后端检查。
- 失败与结果：失败保留范围、勾选和采用方式，禁用确认直至重新比较；409 明确提示目标变化并要求重新比较，不清空用户决策。成功结果及 warnings 先渲染，随后通过 effect 清理查询 bootstrap 缓存、重载月份和业务导入记录；缓存刷新异常不抹去成功结果。reauthentication_required 时不调用业务刷新，保留结果，用户点击重新登录（或关闭结果）后整页进入 `/login`，新页面重新认证。
- Ruling：沿用用户指定原目录和现有未提交实现，不创建只含 HEAD 的新 worktree；旧单月前端 API 函数和后端兼容入口继续保留，新界面使用独立多月函数，共用已有下载进度实现。最终采取作者自审，无子代理，符合本次明确执行方式；自审不替代阶段 10 的全流程验收。
- RED→GREEN：导出先在最小占位组件观察 **2 failed**（缺月份及默认类别交互）；新 API **2 failed / 2 passed**（缺多月能力）；导入新增契约测试先 **14 failed**；App 接入先 **2 failed / 64 passed**（导出未接弹窗、旧 ID 回调不适配多月结果）。逐项最小实现后通过。补测不完整范围批量删除与快照来源先 **2 failed / 16 passed**，姓名/中文依赖提示先 **1 failed / 18 passed**，字段表按需创建先 **1 failed / 19 passed**，修正后通过；导入组件最终 **20 passed**。
- 中间构建发现 ES2020 不支持 `.at()`、刷新回调返回 Promise<number> 与 Promise<void> 不匹配，改为下标读取和显式 await，不更改编译配置。前端全套首次 **464 passed / 1 failed**，CSS 变量检查定位两处新增的未定义 `--acm-border`，改为现有边框色并重跑；未放宽测试断言。
- 最终验证命令与结果（前端命令工作目录 `frontend/`）：
  - `npm test -- src/components/admin/MonthlyBackupExportModal.test.tsx src/components/admin/AccountSetBackupModal.test.tsx src/App.smoke.test.tsx` → **3 files / 88 passed，12.04s**，退出码 0。
  - 扩展 API 定向命令 `npm test -- src/components/admin/MonthlyBackupExportModal.test.tsx src/components/admin/AccountSetBackupModal.test.tsx src/App.smoke.test.tsx src/api/accountSetBackup.test.ts` 中间为 **91 passed**；最后按需字段渲染新增一项也已包含在下列最终全套。
  - `npm test` → **54 files / 466 passed，11.91s**，退出码 0，包含旧单月下载兼容、新多月 API、导入/导出组件、成功后缓存刷新和重新登录结果保留测试。
  - `npm run build` → **成功，退出码 0**；Vite 保留大于 500 kB 的 bundle 提醒（AdminMessagesPage 815.60 kB），未为此改动无关模块。
  - 根目录 `PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_backup_coverage.py tests/test_multi_month_restore_api.py tests/test_multi_month_backup.py -q` → **50 passed in 14.15s**。只使用测试 fixture 的内存/临时 SQLite 和临时文件，不执行根目录 `test_api.py`。
  - `git diff --check` → **通过**；原有更改校验 → **全部原样保留**。
- 验证边界：本阶段前端验证使用组件交互及模拟 HTTP 契约，后端契约测试使用真实测试数据库流程；没有用浏览器连接真实业务库做导出恢复，没有人工端到端验证、真实 MySQL 并发/文件权限/大数据性能测试，没有重跑后端全套或执行迁移。这些属于阶段 10 和后续授权隔离环境验收，不能据此声称全部验收完成。
- 交接：阶段 9 的 8 项复选框已勾选；阶段 10 尚未实施，README 和用户指南未提前编写。继续时核查所有未提交变更，保留阶段 0–9 成果。

## 阶段 10 工作提示词（可直接复制）

```text
请在 /Users/lewis/Lewis/code/git/MTEmpHub 继续实施多月份备份与选择性恢复。
先阅读 AGENTS.md，以及：
1. docs/design/2026-10-09-monthly-backup-design.md
2. docs/design/2026-10-09-monthly-backup-plan.md（含阶段 8、9 实际执行记录）

阶段 0–9 已完成，已有更改均未提交。本次只实施阶段 10：完整验证、使用说明与交接。
先核实代码及 Git 状态，保护所有未提交更改；自己顺序实施，不自动派发子代理。
不操作生产数据库、不部署、不提交、不推送。只在发现新的关键产品取舍时询问，不重复询问已确认需求。
如发现缺陷，先写有意义的失败测试，再作最小修正并验证；不顺手重构无关代码。

默认导出全部类别（包括账号）；冲突默认采用备份；完整且已选范围的系统独有默认不保留。
历史隔离、旧包 absent/incomplete 不误删必须保留。
跨月/年度必须按 server row_key 明确选择，不能大类别自动选择、隐式补依赖或扩展范围。
密码预览只显示一致/不同，不显示哈希；当前资料退出有效集合保留本地 ID，业务移除才是删除记录。
恢复失败回滚全部数据并保留可调整选择；目标变化 409 必须重新比较。
成功先展示结果及 warnings；reauthentication_required 时先保留结果，再引导重新登录，不能立即加载业务。
菜票恢复仅写本地记录，不重放设备、充值或扣款。

阶段 9 现状：
- 账套设置打开多月导出弹窗；全部 11 类默认选中，含完整当前资料和账号；真实进度及 100 MiB 说明。
- 导入界面已用新 /api/admin/backups/ 契约，支持月份/实际类别、覆盖完整性、快照质量与来源。
- 差异筛选、行勾选、筛选结果全选、任意多选、批量 backup/system/skip；勾选集合与 choices 独立，隐藏勾选计数。
- 跨月/年度逐条恢复条目、实际影响月份、全部菜票中文标签、中文字段/依赖提示、渐进渲染及按需字段表。
- 确认区分退出当前资料/删除业务、展示 blocker，失败保留选择，成功刷新缓存或先展示结果再重新登录。
- 最终计划定向前端 88 passed；前端全套 54 files / 466 passed；npm run build 成功但有既有大 bundle 提醒。
- PYTHON_DOTENV_DISABLED=1 后端覆盖与导出/恢复 HTTP 契约检查 50 passed。
- 尚未做浏览器真实全流程验收、真实 MySQL/并发/大数据验证；阶段 10 未勾选。

按阶段 10 计划完成：
1. 核对设计文档第 11 节十个验收场景都有真实测试或明确人工记录，覆盖至少两个月、跨年、源/目标 ID 不同。
2. 只在隔离测试数据库验证升级、v1→统一格式、v2→空库恢复、部分恢复；有环境限制如实记录，不用生产库实验。
3. 检查新增未登记字段覆盖测试会失败，旧包缺失类别不误删。
4. 所有后端测试设置 PYTHON_DOTENV_DISABLED=1；运行 .venv-mac/bin/python -m pytest tests -q 和 tests/test_backup_coverage.py，只用测试数据库，不执行根目录 test_api.py。
5. frontend/ 运行 npm test 和 npm run build；记录实际命令、结果、任何警告/环境限制。
6. git diff --check、git status --short；核对变更范围、Alembic head 与整库迁移清单。
7. 更新 README 的真实入口、资料范围、v1/v2 兼容、默认移除语义、重新登录、快照质量和文件限制；新增 docs/monthly-backup-user-guide.md，按已实现文案写操作、依赖、失败与结果说明。
8. 更新阶段 10 复选框和执行记录，交接完成/未完成项、测试、所需迁移命令及部署限制。迁移命令仅作交接，不实际执行生产升级或部署。

本次不部署、不操作生产数据库、不提交、不推送；不要把前端 HTTP 模拟测试当成真实浏览器/生产验证。
```


## 实际执行记录：阶段 10

- 执行日期：2026-10-10。目录 `/Users/lewis/Lewis/code/git/MTEmpHub`，分支 `master`；本人顺序验证和作者自审，无子代理。实际开始时 `git status --short` 为空，HEAD 为 `216c5a6 feat: add multi-month backups and selective restore`，阶段 0–9 已进入该提交；提示词“全部未提交”与实际状态不同，以实际 Git 为准，未改写历史。本次不提交、不推送、不部署、不操作生产数据库。
- 本阶段初次验证范围：README、用户指南、本计划，新增 `tests/test_monthly_backup_acceptance.py` 两个集成验收测试。没有业务代码、ORM 或迁移改动，不做无关重构。
- 新验收用真实 ZIP 编解码和 ORM 写入，月份 `2026-12`/`2027-01`：新建 schema 只有操作管理员（ID 901），其余业务为空；恢复备份账号产生不同目标 ID（源 ID 1；测试断言目标不等于 1），密码验证、人员/部门授权映射、两月考勤、唯一跨年请假单和两年年假全部核对。跨月/年度先确认不自动选择，再用服务端 row_key 显式选择 1/2 条。部分恢复另验只恢复十二月考勤，一月及未明确选中的跨月/年度记录保持目标值。
- 新测试首次 1 failed / 6 passed：测试误把 scope 当固定 `cross_month`/`annual`，导致显式条目集合为空；查看契约确认应按 `cross_month/<dataset>` / `year/<year>/<dataset>` 前缀读取，修正测试并增加明确条目数量断言后 7 passed。没有把测试错误当业务缺陷、没有放宽产品边界，也没有业务修正的 RED→GREEN 声称。

### 设计第 11 节验收证据

下列都是本次后端全套内实际运行的合成 SQLite 测试；前端组件测试仍使用 HTTP 模拟，不能算真实浏览器恢复。表中的文件与函数可直接定位证据。

| 场景 | 测试证据 | 验证范围 |
| --- | --- | --- |
| 1. 两月只恢复一月考勤 | `test_multi_month_restore.py::test_only_selected_month_is_restored`；新 `test_cross_year_partial_restore_does_not_select_cross_or_annual_rows` | 六/七月及十二月/次年一月，未选月不变，年度及跨月未明确选择不写入 |
| 2. 完整当前资料 | `test_backup_shared_data.py::test_full_shared_collection_includes_unrelated_and_archived_data` | 无业务人员、空部门、未分配班次和归档状态进入完整集合 |
| 3. 历史不漂移 | `test_monthly_reference_integration.py::test_query_calendar_summary_and_meal_recalculation_use_month_identity`、`test_history_download_contains_frozen_name_department_and_hours`、`test_manager_membership_and_recalculation_survive_current_type_change`；恢复测试 `test_cards_parent_reorder_and_current_exit_keep_historical_ids` | 查询、成员、权限、部门汇总、下载、重算和未选月快照保持历史身份 |
| 4. 跨月去重、年度边界 | `test_multi_month_backup.py::test_split_zip_roundtrip_deduplicates_without_losing_relations`；新 `test_cross_year_zip_restores_fresh_schema_and_explicit_rows`；预览 `test_annual_explicit_keys_actual_year_and_locks` | 同一单据只导出/写入一次，跨年两年统计逐条选择，实际影响和锁定月检测 |
| 5. 默认移除、明确保留、旧包子集 | 预览 `test_defaults_and_unselected_month_category`、`test_empty_complete_vs_subset_and_absent`；恢复 `test_legacy_and_absent_categories_do_not_delete_existing_current_data`、`test_cards_parent_reorder_and_current_exit_keep_historical_ids` | 完整所选默认 backup；system/skip 决策和 absent/incomplete 拒删；当前资料退出保留 ID |
| 6. 菜票一致替换、资金关系阻止 | 恢复 `test_meal_replacement_with_changed_batch_key_and_payment_retry`、`test_batch_replacement_deletes_old_children_before_parent_key_change`；预览 `test_meal_complete_replacement_and_mixed_snapshot_block`、`test_mixed_target_only_funds_not_added_to_replaced_history` | FK 开启的真实替换，幂等重试不重复计款，悬空或混合资金关系拒绝 |
| 7. 账号旧密码、不同 ID、旧 JWT | 新跨年新库验收；`test_multi_month_restore.py::test_new_month_and_portable_grants_use_target_business_ids`；`test_backup_account_state.py::test_version_change_revokes_cookie_and_bearer_then_new_login_succeeds`、`test_local_revocation_and_restored_hash_allow_backup_password` | 新库恢复哈希可验证；真实登录接口另测备份密码；不同本地 ID 的授权映射；旧 cookie/Bearer 失效 |
| 8. 多月与文件失败原子回滚 | `test_second_month_database_failure_rolls_back_first_month`、`test_file_write_failure_preserves_database_and_originals`、`test_avatar_bytes_restore_and_database_failure_cleans_new_files` | 第二月失败前一月回滚，文件错误保留原文件，账号密码/新文件回滚 |
| 9. 未登记字段及旧包保护 | `test_backup_coverage.py`；`test_backup_document.py::test_legacy_missing_non_meal_category_stays_absent`；恢复 `test_legacy_and_absent_categories_do_not_delete_existing_current_data` | 新表/字段包括排除表字段均检测，旧包缺类别不当空完整；另有本次注入失败实证 |
| 10. 只读预览及任务保护 | 预览 `test_password_redaction_versions_and_zero_writes`；HTTP `test_multi_owner_expiry_target_change_and_failed_audit`、`test_multi_upload_repreview_restore_repeated_and_cancel`、`test_completed_audit_prevents_replay_when_metadata_write_fails` | 零业务写入；他人、过期、成功重放、目标变化拒绝，持久审计防重复 |

### 隔离、兼容和迁移核查

- 所有后端命令设置 `PYTHON_DOTENV_DISABLED=1`，fixture 使用内存/临时 SQLite 与临时文件。未执行根目录 `test_api.py`，未读取 `.env` 去连接业务数据库。
- 升级证据：`test_monthly_reference_snapshot.py::test_snapshot_upgrade_preserves_rows_and_is_compatible_with_create_all` 与 `test_backup_account_state.py::test_account_state_upgrade_preserves_legacy_users_and_audit` 在临时库实际执行 Alembic/legacy 路径，保留存量行、默认状态、幂等；不是实际 MySQL 升级。MySQL 只做方言编译和模拟 SQL 边界测试。
- 固定旧包：`tests/fixtures/monthly_backup/legacy-v1.zip` 由 `test_fixed_legacy_zip_can_be_read_by_old_and_normalized_callers` 验证 v1→统一格式；旧路径和新路径兼容实际恢复测试均保留。
- 覆盖注入：独立 Python 进程给 `Employee.__table__` 临时追加 `stage10_unregistered_field`，运行 `test_every_model_and_field_has_a_backup_decision` 得到预期 **1 failed**（报告 `employees.stage10_unregistered_field`）；断言 pytest 退出码 TESTS_FAILED 后结束进程。没有写 ORM 文件或数据库 DDL。随后正常覆盖检查 **5 passed in 0.17s**。
- 只读 Alembic ScriptDirectory 核查唯一 head **`20261009_account_state`**，down_revision 为 `20261009_month_refs`；本阶段不新增迁移。第一次直接读取 `migrations/alembic.ini` 因没有 script_location 报错，改为显式 `Config.set_main_option('script_location', 'migrations')`，不创建应用也不连接数据库。
- 整库迁移 `MIGRATION_ORDER` 包含快照、账号完整列及授权、考勤修正历史和菜票业务；与 metadata 对比仍缺 **`account_set_backup_origins`、`account_set_backup_restores`、`daily_attendance_overrides`、`messages`** 四张既有表。README 修正为实际表名；这是已有整库切换限制，本次不扩展功能修复。切库不能宣称完整搬迁，文件也不会自动复制。

### 实际命令与结果

- 基线全套：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q` → **866 passed in 242.07s**（不含本阶段两项新测试），退出码 0。
- 新验收与覆盖：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_monthly_backup_acceptance.py tests/test_backup_coverage.py -q` → **7 passed in 1.02s**。
- 隔离升级/格式/覆盖定向：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_backup_document.py tests/test_backup_coverage.py tests/test_monthly_reference_snapshot.py tests/test_backup_account_state.py tests/test_monthly_backup_acceptance.py -q` → **70 passed in 9.29s**。
- `frontend/` 内 `npm test` → **54 files / 466 passed，10.35s**，退出码 0。`npm run build` → **成功，退出码 0**；仍有既有 >500 kB bundle 提醒，AdminMessagesPage 815.60 kB，未做无关拆包。
- 最终包含新增验收的后端全套：`PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q` → **868 passed in 257.77s（4:17）**，退出码 0，无失败或警告。
- 完整日志临时保存在 `/private/tmp/mtemphub-stage10-{backend,backend-final,frontend,build,acceptance,isolation,coverage-mutation}.log`；长期交接以本执行记录的命令和结果为准。

### 浏览器实际记录与未完成项

- Chrome 使用独立 `http://127.0.0.1:5098` 和 `/private/tmp/mtemphub-stage10-browser/acceptance.db`，全部合成数据：十二月/次年一月考勤、测试部门/人员及跨年请假。独立 Cookie 名 `stage10_test_token`。临时脚本显式禁用 dotenv、指定数据库及运行目录，为合成账号提供预置测试会话；未测试真人登录/验证码，也没有进入原业务标签页进行操作。临时测试脚本和会话入口不写入仓库、不用于部署。
- 浏览器实际打开账套设置、多月导出弹窗：确认 2026-12/2027-01 可选、11 类默认选中（含账号）、完整当前资料说明和 100 MiB 提示；点击开始导出后页面显示 **“备份下载完成 100%”**，Chrome 下载列表显示 **“多月份备份.zip 3.8 KB · 完成”**。自动等待 download 事件超时，但界面和下载列表证实完成，未将工具等待失败误记为业务失败。
- 进入“导入月度账套”并点击“选择账套备份”，尝试上传合成 `cross-year.zip` 时扩展要求 “Allow access to file URLs”；未改变扩展权限。**当时浏览器上传→比较→确认→恢复结果/重新登录尚未完成；用户开启权限后已补验，见下方续验记录**，不能把组件模拟 HTTP 或后端集成通过写成浏览器全流程通过。验收服务已经停止；关闭测试标签页时浏览器工具报告不可用，不操作其他业务标签页。
- 当时待办的浏览器上传、部分恢复、跨月/年度明确选择、409 重比、失败保留选择、成功 warnings 和结果后重新登录已在下方续验完成。仍待授权隔离环境完成：真实 MySQL 升级/恢复/并发锁；文件权限/磁盘异常的目标环境验证；大月份/大差异性能及接近文件上限的真实规模验证。当前没有指定隔离 MySQL 实例，不借用生产连接。

### 运维交接（命令仅交接，本次未执行生产升级）

先完整备份现有数据库、上传目录与配置，检查目标连接和权限；在授权隔离副本验收后再安排升级。使用目标环境 Python，mac 本地可替换为 `.venv-mac/bin/python`：

```bash
# 现有已纳管数据库：核对现状，再升级、检查 head
python -m flask --app manage.py db current
python -m flask --app manage.py db upgrade
python -m flask --app manage.py db current
# 预期最终版本：20261009_account_state

# 全新空库（基线迁移依赖已存在表，不能直接 db upgrade）
python -m flask --app manage.py init-db
python -m flask --app manage.py init-admin

# 旧月先只读核对，不自动采集/重算
python -m flask --app manage.py scan-month-references --inspect-archives
# 人工核对并明确同意基线语义后，才选择指定月份采集，例如：
python -m flask --app manage.py capture-month-references --month 2026-12 --month 2027-01
```

历史兼容结构/版本不一致时参考 README 的 `upgrade-legacy-schema` 流程，先核对实际结构，不能盲目 stamp 或把兼容补丁当所有迁移。baseline 不证明真实过去；证据冲突需明确选取，不能自动把当前值当 verified。

本次交接不授权生产升级、部署、提交或推送。README 和用户指南已反映真实按钮、范围、默认移除、旧包保护、依赖、快照质量、账号结果先展示再重新登录及限制；阶段 10 的自动化验证与文档交接不等于生产就绪签收，上述真实环境事项继续保留待办。

- 文档校验：核对验收表完整文件/函数引用及 README/指南相对链接，均存在；`git diff --check` 通过。
- 作者自审：遵照本次不派发要求，自行核对新增测试、真实按钮文案、文档默认策略、兼容/回滚/历史隔离、迁移清单及验证边界；没有发现需修改业务实现的缺陷。不是独立审查代理或生产验收。


### 最终状态

- 阶段 10 上述 8 项验证/文档/交接复选框已勾选，依据本记录逐项证据；新增 2 项验收测试；续验先写真实浏览器失败断言，再作一处必要 CSS 修正。所有设计验收场景已有测试证据，但仍保留以下环境验收事项：
  - [x] 隔离浏览器真实上传→比较→选择→确认→结果、warnings 及重新登录跳转；见续验。真人登录/验证码未测。
  - [x] 真实隔离 MySQL 8.0.46 增量升级、恢复与独立连接并发锁验证（见后续记录）。
  - [ ] 实际部署环境文件权限、磁盘异常、多主机与高并发压力验证。
  - [x] 合成 24 月 / 67,200 条考勤与 90 MiB 文件，在 SQLite 和真实 MySQL 验证（见后续记录）。
  - [ ] 大列表浏览器/网络端到端性能与实际业务数据代表性负载验收。
- 初次收尾 `git diff --check` 通过；当时仅文档与新增验收测试改动。续验增加一处 CSS 和浏览器回归断言，最终状态见下方。HEAD 仍为 `216c5a6`，未 stage/commit/push；没有生产库、设备或外部资金操作。

### 用户开启文件访问权限后的真实浏览器续验（2026-10-10）

- 用户开启扩展文件访问权限后，Chrome 实际上传成功。继续使用 `127.0.0.1:5098` 的构建前端、真实 Flask 路由与专用临时 SQLite 合成库，未访问生产数据库。没有子代理、生产升级、部署、提交或推送。会话预置入口只在临时脚本中，真人登录/验证码不属于本次浏览器证据。
- 部分恢复：上传十二月/次年一月 ZIP，仅选择十二月考勤。预览后直接变更隔离库目标值，真实恢复接口返回 **409**；页面显示“系统数据已变化，请重新比较并检查差异后确认。”、保留选择并阻止确认。重新预览后恢复成功；实际数据库十二月为 8、一月仍为 1。
- 账号恢复：只选账号类别，密码预览显示“一致”，未显示哈希；恢复结果先留在账套页，并提示核对结果后重新登录。点击“重新登录”才跳转 `/login`。账号资料与本地 auth_version 更新已在隔离库核对。
- 多月失败：只在临时 SQLite 创建第二月更新失败的测试 trigger。浏览器选两月差异、批量采用备份并确认，接口失败；数据库十二月/一月仍为失败前的 3/2，全部回滚。行勾选和 choices 保留；筛选十二月时隐藏勾选计数为 1。移除本次测试 trigger、重新预览并重试后两月为 8/7。
- 跨月/年度：合成 ZIP 包含唯一跨年请假单与 2026/2027 两条年假。只选择十二月、跨月和年度类别时条目仍未自动选择；逐条勾选服务端条目后，确认展示跨年影响及两年实际影响月份。成功 3 项更新：年假为 5/6、请假类型恢复为病假；考勤仍为 8/7，未隐式扩展类别。
- 成功 warnings 与重新登录同屏：仅在临时服务注入清理异常，业务事务真实提交。浏览器结果显示 2 项更新、警告“旧归档清理暂未完成，恢复数据已保存，下次恢复时会重试”，随后才提供重新登录引导。数据库考勤/账号已恢复；服务日志在 restore 200 后、点击重新登录前没有业务 GET。不是模拟前端 HTTP 响应，也没有触碰真实归档。测试注入和标记不写入仓库。

**发现缺陷及 RED→GREEN：** 多条年度/跨月差异存在时，弹窗 flex 布局把 `.backup-differences` 压到 **0 px**，14 条记录在 DOM 内但不可见、无法操作。先新增 `docs/testing/monthly-backup-browser-layout.js` 的实际浏览器断言，在旧样式上得到 `Backup rows are inaccessible: 14 rows, 0px scroll area`。随后仅在 `frontend/src/pages/admin/account-center.css` 增加 `flex-shrink: 0`。重建、重新上传，在同一浏览器断言得到 **14 rows / 260 px**，然后完成上述逐条恢复。这段断言需在 cua_repl 的隔离 tab 上运行 `await assertMonthlyBackupListVisible(tab)`；不将 jsdom 测试算作实际布局验证，不重构其他样式。

- CSS 修正后 `frontend/`：`npm test` → **54 files / 466 passed，11.40s**，退出码 0；`npm run build` → 成功、退出码 0，仍有既有 AdminMessagesPage **815.60 kB** / >500 kB 提醒。日志 `/private/tmp/mtemphub-stage10-browser-{frontend,build}.log`。后端代码未变，沿用本阶段已跑的 **868 passed** 全套结果，不声称续验重跑了后端。
- 续验收尾：移除本次临时故障标记并停止隔离服务；`git diff --check` 通过。`git status --short` 为 README、本计划、单行 CSS modified，用户指南、浏览器布局断言、后端验收测试 untracked；HEAD 仍为 `216c5a6`。未 stage/commit/push。
- 此次浏览器续验结束时，MySQL 与规模验证仍待办，之后已按下节限定范围补验。目标环境文件权限/磁盘异常、浏览器大列表/网络性能、真人登录/验证码仍未完成；不能替代生产签收。

### 真实 MySQL、并发与规模续验（2026-10-10）

- 沿用原目录、全部未提交更改和顺序执行要求，无子代理。本次只新增独立验收脚本 `docs/testing/monthly_backup_mysql.py`、`docs/testing/monthly_backup_scale.py` 和 [隔离复跑说明](../testing/monthly-backup-verification.md)，更新本记录；没有业务代码、ORM、备份登记或迁移改动。
- 本机没有 mysqld/MariaDB、Docker/Podman。使用官方 `mysql-8.0.46-macos15-arm64.tar.gz`，MD5 与官方值 `aefb850c25a2c703a63554283fb94cae` 一致，解压到 `/private/tmp/mtemphub-stage10-mysql`。`--no-defaults` 初始化独立 data，启动参数 `--skip-networking --mysqlx=OFF`，只允许该目录 Unix socket。实际只读核对 **8.0.46 / REPEATABLE-READ / port 0 / skip_networking 1**，datadir 为该临时目录。没有全局安装、Homebrew 服务、生产连接或项目 `.env`。
- 默认沙箱下 mysqld 初始化/启动崩溃，允许系统调用后初始化成功；默认沙箱也禁止 Unix socket 连接，精确授权临时实例的测试命令后可运行。没有因权限错误改用生产实例。`.venv-mac` 缺 `pymysql`；网络安装先因解析限制失败，随后下载项目指定的 PyMySQL 1.1.1 wheel 并核对 PyPI SHA256，只安装在 `/private/tmp/mtemphub-stage10-python`，未修改现有虚拟环境或 requirements。
- MySQL 测试先核对 `@@datadir`，每项创建随机 `mtemphub_stage10_<uuid>` schema，结束只清理自己创建的 schema。stamp 只在这些测试 schema 重建的明确旧状态使用，不是生产 stamp。两项增量迁移从 `20261009_meal_rules` 实际升级至 `20261009_account_state` 并重复 upgrade，原员工、账号和审计行保留，默认有效、auth_version 0、操作人名称回填正确。
- 真实 MySQL 覆盖：跨年两月 ZIP 到业务空库、源账号 ID 1→目标不同 ID、密码/授权、逐条跨月/两年年假；只恢复选月；v1 ZIP→统一格式和旧资料 absent/incomplete 保护；v1 厂休/归档实际恢复；多月第二月失败全部回滚；菜票外键开启状态下父 key 替换及本地幂等重试。
- 并发不是 SQL 模拟：独立连接更新在恢复持锁时进入 `performance_schema.data_lock_waits`，恢复完成后才提交；普通写入先持锁并提交后，等待的恢复读到新值、拒绝旧指纹；同主机两项恢复串行，后一项因指纹变化被拒绝，成功/失败审计分别一条。没有隐式扩大恢复选择。
- 初次真实 MySQL **2 failed / 8 passed in 4.39s**：复用菜票测试含 SQLite `PRAGMA`；另一断言把失败审计也算作成功。改为检查 MySQL `@@foreign_key_checks=1`、明确成功/失败两条审计，业务代码未变。修正后 10 passed，追加先行写入/旧包恢复后 **13 passed in 5.49s**。

实际命令（全部禁用 dotenv）：

```bash
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=.:/private/tmp/mtemphub-stage10-python .venv-mac/bin/python -m pytest docs/testing/monthly_backup_mysql.py -q -s
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=. .venv-mac/bin/python -m pytest docs/testing/monthly_backup_scale.py -q -s
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=. .venv-mac/bin/python -m pytest docs/testing/monthly_backup_scale.py::test_real_ninety_mib_archive_and_over_limit_rejection tests/test_backup_coverage.py -q -s
```

- SQLite 规模最终 **2 passed in 67.62s**：24 月、100 人、67,200 条日报；导出校验 20.522s，读取 2.131s，69,751 条预览（含快照/账套等）19.796s，恢复明确所选十二月 2,800 条 22.050s，其他 23 月保持原值。ZIP 323,016 bytes，整个进程峰值 RSS **1,230,503,936 bytes（约 1.23 GB）**。测量使用实际 ORM/ZIP/数据库，没有假进度、mock HTTP 或生产数据。
- 90 MiB 随机文件 ZIP（不可用压缩零填充冒充大小）实际导出、读入；追加恢复后核对目标文件大小和 SHA256。补验文件恢复与覆盖登记最终 **6 passed in 2.40s**：导出校验 1.572s、读取 0.113s、写入恢复 0.097s；ZIP 94,403,018 bytes。100 MiB + 1 字节的文件导出和上传读入都实际拒绝。
- 规模脚本初次文件测试只选 archives，没有选择该归档所属 attendance 类别，实际包正确不包含原文件；改正测试范围后通过。追加恢复测试后，超限检查误修改恢复前原路径而非已经恢复的目标路径；改为目标路径后通过。都是测试构造问题，没有修改业务实现或声称业务 RED→GREEN。

- MySQL 规模同样使用真实 ORM/ZIP 与随机 schema：24 月导出校验 **39.198s**、读取 **2.066s**、预览 **38.693s**、明确所选月恢复 **42.911s**；67,200 条考勤保持总数，2,800 条恢复，其他月保持原值。预览 69,751 条，ZIP 314,934 bytes，进程峰值 RSS **1,244,528,640 bytes（约 1.24 GB）**。
- 包含规模的 MySQL 批次 **14 passed / 1 failed in 134.00s**：运行中的 Python 已加载超限检查旧路径版本，文件读写/恢复本身成功，只有该测试构造断言失败。修正路径后仅定向重跑该项（不无故重复已通过的 24 月验证）：**1 passed in 2.52s**，导出校验 1.490s、读取 0.106s、恢复 0.107s、ZIP 94,403,008 bytes，峰值 RSS 465,371,136 bytes。最终 15 项都有通过证据，但不是一次“15 passed”的命令结果，不能把中间失败省略成全程绿灯。
- 完整临时日志：`/private/tmp/mtemphub-stage10-mysql-{tests,final,scale-final,file-final}.log` 和 `/private/tmp/mtemphub-stage10-scale{,-final,-file-final}.log`；最终命令可按隔离复跑说明执行。普通后端 tests/ 的上次 **868 passed**、前端 **466 passed** 与构建成功保留为前次证据；本次没有业务/前端修改，不声称重新跑了这些全套。本次覆盖检查实跑 **5 passed**（上述 6 项内）。
- 收尾确认临时实例所有 `mtemphub_stage10_*` schema 已清理，校验 datadir 后只关闭该测试实例。保留临时压缩包和独立数据目录供复跑，未安装全局服务。`git diff --check` 通过，HEAD 仍为 `216c5a6`；保护原未提交修改，无 stage/commit/push、部署、生产库或设备操作。作者自审确认新增脚本显式隔离、实际测试证据与失败记录，不派发审查代理。
- 结论与边界：真实 MySQL 增量迁移、恢复、独立连接并发和本次 24 月/90 MiB 限定规模验证已有证据；**没有新发现需要修改业务实现的缺陷**。约 39 秒 MySQL 预览、约 1.24 GB 峰值不是性能优化成果或生产容量保证。本阶段不顺手优化；实际 MySQL 版本/配置、全历史升级链、多主机、故障/权限/磁盘、浏览器大列表及网络上传、代表性负载/更高并发仍需在目标隔离环境签收。迁移 head 和此前整库迁移四表缺口保持原交接，不执行生产迁移。

### 用户授权提交与推送前的验证（2026-10-10）

用户随后明确要求“提交并推送”，本次据此提交阶段 10 文件；此前不提交/不推送的记录描述当时行为。生产数据库操作和部署仍未授权、未执行。

- 提交前新跑 `PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests -q` → **868 passed in 252.79s**，退出码 0；没有执行根目录 test_api.py。
- 独立覆盖检查 `PYTHON_DOTENV_DISABLED=1 .venv-mac/bin/python -m pytest tests/test_backup_coverage.py -q` → **5 passed in 0.15s**。
- `frontend/` 新跑 `npm test` → **54 files / 466 passed，14.15s**；`npm run build` 成功，退出码均为 0，保留既有 AdminMessagesPage 815.60 kB / >500 kB 警告。
- 只读复核 Alembic 唯一 head `20261009_account_state`；`git diff --check` 与暂存区检查通过。实际 MySQL/规模证据沿用上一节，不虚称此次再次启动临时实例。
- README 和用户指南同步续验后的真实状态，区分已完成的隔离 MySQL/并发/限定规模与未完成的目标环境、多主机和浏览器大列表压力验收。
- 提交范围仅 9 个阶段 10 文件；不包含临时数据库、下载包、依赖或日志。提交前只读查询 origin/master 为 `216c5a6`，与原本地基线一致。后续普通推送，不使用 force。

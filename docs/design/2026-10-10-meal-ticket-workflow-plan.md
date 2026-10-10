# 菜票中心流程简化实施计划

> **For agentic workers:** 使用 `executing-plans` 按阶段执行；用户采用新对话逐阶段实施方式。本计划不要求启动子代理。每次仅完成一个阶段，验证、更新执行记录并给出下一对话文案后停止。

**Goal:** 保留月度计算、重算、导出能力，消除重复入口；后续补扣按工号逐人充值/取款，支持默认开启的同人抵消与可靠进度。

**Architecture:** 复用现有核算、补扣、支付和数据库核对服务。新增独立的后续待办与流水分配层，将操作标记与真实资金分离；页面按实际账目和待办状态呈现当前操作。

**Tech Stack:** Flask、SQLAlchemy、Python pytest/unittest、React、TypeScript、Vitest、现有 XLS 导出。

**Spec:** `docs/design/2026-10-10-meal-ticket-workflow-design.md`

**文档位置:** 项目 `.gitignore` 排除 `docs/superpowers/`，本方案沿用已有 `docs/design/`，方便后续正常版本管理。

**交接文案:** `docs/design/2026-10-10-meal-ticket-workflow-handoff.md`

## Global Constraints

- 每次实施前读 AGENTS.md、Spec、本计划及执行记录；先检查工作区与已完成阶段，不重做已完成工作。
- 原规划对话只授权文档；2026-10-10 阶段 1 启动已授权本阶段代码，内联执行、无需子代理。不自动推进、不推送、不发布、不操作生产数据；本次保留未提交状态。
- 月度发放与后续补扣保留为两页；确认后只能在后续补扣页调整。
- 月度页保留计算、重算草稿、确认核算、两列 XLS；后续补扣页不导出充值表、不批量操作设备。
- 设置放项目 `/admin/more-settings`；`meal_ticket_offset_enabled` 缺失默认 true，立即保存，全局安装级配置。
- 财务金额整数分；外部逐人操作，工号字符串保留前导零；不自动调用设备。
- 操作声明不改变净已发；资金来源去重、幂等、版本、权限、源月份锁定和负应发校验保留。
- 新业务字段/表的备份映射、预览恢复、依赖和版本兼容同阶段完成；每阶段运行 `tests/test_backup_coverage.py`。
- 只改本次需要的文件，不顺带清理或重构其他业务。新组件仅为分离当前任务卡片与后续任务服务。
- 各阶段正常完成后停止，不自动推进、不自动推送；需要提交时仅提交本阶段文件，保留用户未提交修改。
- 失败不能标完成；记录真实结果、剩余事项，并提供继续当前阶段的文案。

## Review Focus

1. 关闭抵消且净差额为零：仍有两个方向任务；由阶段 2、5 测试验证。
2. 已操作但流水延迟：刷新、切换设置均不能重复提示办理；由阶段 2、4、5 测试验证。
3. 工号前导零、同名/同额、多次调整：稳定 key 与明确流水关联，不能错人错月；由阶段 2、4、5 测试验证。
4. 旧月份/旧备份缺后续任务：不重发历史、不删除目标任务；由阶段 2、6 测试验证。
5. 已到账后冲正、来源变化、并发：恢复正确剩余任务，拒绝旧快照覆盖；由阶段 2、5、6 测试验证。

## 阶段总览

| 阶段 | 可独立验收的产物 | 后续依赖 |
| --- | --- | --- |
| 1 | 全局抵消开关、明确契约及金额投影测试 | 阶段 2、4 |
| 2 | 后续待办/进度/流水分配后端，备份及迁移闭环 | 阶段 4、5 |
| 3 | 月度发放页简化，必要操作仍可用 | 阶段 6 |
| 4 | 后续补扣页逐人操作界面 | 阶段 5 |
| 5 | 实际流水/手工登记/任务核销联调 | 阶段 6 |
| 6 | 整体验收、文档、最终交接 | 完成 |

## 固定接口方向

新接口沿用 `/api/meal-tickets` 蓝图，并使用管理员权限及既有错误包装。
`GET /followup-tasks?recharge_month=YYYY-MM`：只读获取任务、当前全局设置及清单快照；GET 不生成任务、不改进度。
`POST /followup-tasks/refresh`：显式生成/刷新尚未操作的任务，提交 batch_id/version/settings_digest；保留待核对与实际分配。
`POST /followup-tasks/<task_key>/progress`：pending→skipped/awaiting 或允许的撤销/重新办理；提交批次和任务版本、action、request_key；重新办理附 reason。
`GET /followup-tasks` 返回：batch_id、batch_version、offset_enabled、settings_digest、queue_offset_enabled、settings_changed、tasks。
每项返回稳定 key、item_key、emp_no、name、dept_name、kind(recharge/refund)、amount_cents、allocated_cents、remaining_cents、status、version、operation_at。
任务金额为该任务方向的正数分，不用正负展示方向；`remaining_cents` 不含已分配实际金额。
真实核销仍经现有 `/reconcile` 或支付接口；后续手工支付增加可选 task_key，普通支付原逻辑保持。
最终新增接口和字段须在阶段 1 执行记录固定；若发现必要差异，解释后更新 Spec/计划，不偷偷删需求。


### 阶段 1 固定的后续契约（2026-10-10）

以下 followup 接口/模型是阶段 2 的实施契约，本阶段只实现更多设置 API 和纯投影函数。

- `GET/PUT /api/admin/more-settings` 响应两个布尔字段：`meal_ticket_abnormal_deduction_enabled`（缺失 false）、`meal_ticket_offset_enabled`（缺失 true）。PUT 是非空部分更新，仅接受这两个已知字段；先验证全部字段再保存，非布尔/未知字段/空对象返回 400，非管理员返回 403。旧的仅提交异常扣除字段的请求继续有效。安装级值仍用现有 SystemSetting 的 true/false 文本存储。
- `project_pending_amounts(recharge_cents, refund_cents, offset_enabled)` 不读取数据库。金额必须严格为非负 int（bool 不算 int），开关严格为 bool；非法输入抛 ValueError。输出为正整数分与 recharge/refund 方向；固定先充值后取款，省略零金额。输入由后续服务从已核对基线、未消费来源生成，排除实际已分配金额和 awaiting/partial 任务占用的义务。投影本身不证明基线可靠，不负责到账匹配。
- 后续接口前缀为 `/api/meal-tickets`，管理员权限及既有 MealError 包装。GET `/followup-tasks?recharge_month=YYYY-MM` 只读，不建任务、不改状态。响应保留上文全部字段；无批次/无已生成清单时 batch_id/batch_version/queue_offset_enabled 可为 null，tasks 为 []，不能据此声称已结清。增加 `baseline_required` 布尔值及 `baseline_reason` 说明，可靠基线未建立时禁止生成分开方向的历史任务。
- POST `/followup-tasks/refresh` 提交 `batch_id`、`version`（批次版本）、`settings_digest`、`request_key`。只刷新 pending/skipped；其余状态保留且不重新抵消。POST `/followup-tasks/<task_key>/progress` 提交同一批次 id/version、`task_version`、`action`、`request_key`，retry 附非空 reason。两类写入返回最新 GET 结构；改变清单或进度时增加批次版本，任务变化增加任务版本。旧批次/任务/设置快照返回 409；不存在返回 404；参数非法返回 400。每次写入同事务校验/保存；相同 request_key 和内容重复返回既有结果，不重复写入，换内容返回 409。
- action 固定为 `skip`（pending→skipped）、`complete`（pending/skipped→awaiting，仅操作声明）、`undo`（尚无实际分配的 awaiting→pending，仅撤销标记）、`retry`（经明确确认尚未到账，awaiting/partial 的未到账剩余重新办理，必须记录原因且不重放已到账部分）。partial/verified 只能由真实有效分配派生，superseded 只能由安全刷新失效任务产生。设置切换不能将 awaiting/partial 自动退回 pending。
- `settings_digest` 为现有 digest 函数对仅包含 `meal_ticket_offset_enabled` 的对象生成的摘要，异常扣除开关不纳入；`offset_enabled` 为当前全局值，`queue_offset_enabled` 为最新未操作清单的生成快照，`settings_changed` 比较两者摘要。已操作任务保留各自快照；每项除既定字段再返回 `offset_enabled`、`settings_digest`，允许同一响应包含不同历史快照的待核对任务。
- 每项 `key` 即 task_key，item_key 为现有 MealTicketItem.key，emp_no 始终字符串，amount_cents 为该任务正整数方向金额，allocated_cents 为有效真实分配之和，remaining_cents = amount_cents - allocated_cents。awaiting/partial 的 remaining 不等于可直接重新办理的金额；必须走 retry。任务按部门、工号、方向固定排序，skipped 到队尾。`operation_at` 为可空 ISO 时间。
- 阶段 2 模型采用 `MealTicketFollowupTask` 和 `MealTicketFollowupAllocation`，按计划字段保存任务来源、资金基线、抵消快照、操作状态和分配。key 沿用现有 `new_key()` 的 32 位 UUID hex，金额/来源变化需替换未操作任务时旧任务 superseded、新任务新 key；无变化刷新保持 key，已操作 key 保持。portable 引用用 batch.key/item.key/adjustment.key/payment.key/task.key；员工引用用工号，不把数据库 id 写成跨库来源标识。source_snapshot 保存实际核对过的支付 key/有效金额、调整来源 key/未消费金额、基线时点、设置摘要、请求内容摘要和操作原因历史；仅以日期或同额流水判定到账不够。单笔资金分配不得重复或超过有效金额，早于基线的历史同额支付不匹配新任务。
- 首次接入旧月份先核对真实账。不能确认历史调整消费关系时，只提供已证实净差额；关闭抵消的历史方向义务须管理员确认基线/剩余方向金额，记录说明和来源。无法建立可靠基线返回 baseline_required，不能把历史全部正负调整重新排队。
- 阶段 2 提供 `allocate_payment(task_key, payment_key, amount_cents, operator)`，校验同人、同方向、基线、有效资金与可用余额，重复不加金额；冲正恢复剩余义务，多笔同额不能唯一归属时等待人工关联。阶段 5 才接入 reconcile/手工支付自动分配。手工 `/payments` 增加可选 task_key（沿用批次 version，并校验 task_version）；只对有效任务按方向剩余金额登记。现有 payment() 的普通充值 ≤ due-paid、扣回 ≤ paid-due 限制保持，不能整体放宽来实现关闭抵消的 40/16。
- system_settings 继续整表排除月度备份：它含安装级凭证，新键无需新增 ORM 字段，已有排除理由仍适用。任务抵消快照阶段 2 随业务数据备份；旧包缺任务/分配是 absent，不能删除目标已有任务或恢复为待重办。当前任务定位/跳过顺序的持久化具体字段在阶段 2 与备份映射一起确定，不能靠浏览器状态代替任务业务状态。

## 阶段 1：设置与任务金额契约

**Files:**
- Modify: `frontend/src/pages/admin/MoreSettingsPage.tsx`, `frontend/src/api/admin.ts`, `routes/api_admin.py`。
- Create: `services/meal_ticket_followup_service.py`（本阶段仅纯金额投影与契约，不接入旧页面）。
- Test: `frontend/src/pages/admin/MoreSettingsPage.test.tsx`, `tests/test_api_admin.py`, `tests/test_meal_ticket_followup.py`。
- Read: `models/system_setting.py`, `services/meal_ticket_service.py`, `services/meal_ticket_reconciliation.py`, `services/account_set_backup_schema.py`。

**Interfaces:** 产出 `project_pending_amounts(recharge_cents: int, refund_cents: int, offset_enabled: bool) -> list[dict]`。
输入是服务端已计算的“未消费充值义务、未消费扣回义务”，两个非负整数；不是历史全部正负调整合计。
结果仅包含 `kind` 和正数 `amount_cents`。设置响应同时包含两个开关；PUT 接受一个或两个已知布尔字段，未提交字段保持。

- [x] 阅读上述文件并在记录中明确旧数据基线、关闭抵消的支付限制、任务/分配的可移植 key 方案。
- [x] 为默认 true、两个开关独立更新、非布尔拒绝、非管理员拒绝写 API 测试；先运行观察目标断言失败。
- [x] 添加金额投影失败测试，例如：

```python
from services.meal_ticket_followup_service import project_pending_amounts

def test_offset_keeps_net_recharge():
    assert project_pending_amounts(4000, 1600, True) == [
        {'kind': 'recharge', 'amount_cents': 2400}]

def test_disabled_offset_preserves_both_directions():
    assert project_pending_amounts(2400, 2400, False) == [
        {'kind': 'recharge', 'amount_cents': 2400},
        {'kind': 'refund', 'amount_cents': 2400}]

def test_equal_offset_requires_no_operation():
    assert project_pending_amounts(2400, 2400, True) == []
```

- [x] 最小实现投影：开启时计算两个输入之差，输出相应方向；关闭时输出两个非零方向。负数/非整数调用输入被拒绝。
- [x] 扩展设置读写；在现有设置页下方添加独立开关，同一开关只一个入口；保存失败恢复值，两个开关不互相覆盖。
- [x] 前端测试默认开启、保存 pending、失败、独立字段保留。确认旧异常扣除接口兼容。
- [x] 按下面命令验证，记录实际输出；说明安装级设置表仍排除月度备份，任务快照在阶段 2 随业务数据保存。

```bash
.venv-mac/bin/python -m pytest tests/test_api_admin.py tests/test_meal_ticket_followup.py tests/test_backup_coverage.py -q
```

在 `frontend` 工作目录：

```bash
npm test -- src/pages/admin/MoreSettingsPage.test.tsx
npm run build
```

**完成标准：** 已有更多设置页可切换默认开启的新开关；旧开关不回归；固定服务接口及旧数据接入规则；阶段 2 未完成前不将关闭抵消接入办理页面。

## 阶段 2：持久化任务、进度与资金分配

**Files:**
- Modify: `models/meal_ticket.py`, `services/meal_ticket_followup_service.py`, `routes/meal_tickets.py`, `services/bootstrap_service.py`, `services/migration_service.py`。
- 必要时 Modify: `models/__init__.py`, `services/meal_ticket_service.py`（仅任务校验调用）、相关模型注册。
- Modify: `services/account_set_backup_schema.py`, `services/account_set_backup_service.py`, `services/account_set_restore_service.py`, `services/multi_month_restore_preview.py`, `services/multi_month_restore.py`, `services/backup_document.py` 中与新任务相关部分。
- Create Test: `tests/test_meal_ticket_followup.py`（扩展）, `tests/test_meal_ticket_followup_backup.py`。
- Extend Test: `tests/test_backup_coverage.py`, `tests/test_multi_month_restore_preview.py`, `tests/test_multi_month_restore.py`, `tests/test_migration_service.py`。

**Interfaces:** 消费阶段 1 金额投影与设置键，产出固定接口的任务列表、刷新和操作进度写入。
推荐两个模型 `MealTicketFollowupTask`、`MealTicketFollowupAllocation`：前者按 batch_key/item_key、来源锚点与方向记录任务；后者按 task_key/payment_key 分配正整数分。
任务至少保存 key、month、batch_key、item_key、kind、amount_cents、status、version、source_snapshot(JSON)、offset_enabled、operator、operation_at、created_at。
`source_snapshot` 保存已核对资金基线、调整来源业务 key、设置摘要及请求幂等记录。不能只保存本地数据库 ID。
分配至少保存 key、month、task_key、payment_key、amount_cents、created_at，限制同任务同支付重复分配和资金总分配超额。
保存 current task/顺序及跳过状态所需字段在本阶段覆盖注册；当前任务定位可采用按用户/批次的非业务导航偏好，但不能用它代替任务状态。

- [x] 写无任务只读、显式创建、净额 24、关闭 40/16、关闭 24/24、历史已到账不再生成的失败测试。
- [x] 实现业务来源锚点：首次先核对基线；仅剩余义务入队；调整后刷新未操作任务；保留 awaiting/partial/verified。
- [x] 实现 pending/skipped/awaiting/partial/verified/superseded 合法转换；双击相同请求幂等，旧任务版本返回 409，操作声明不写支付。
- [x] 写并发修改、暂停返回、设置切换与待核对保护的失败测试，再实现保护。
- [x] 为阶段 5 提供服务函数 `allocate_payment(task_key, payment_key, amount_cents, operator)`：在业务事务内检查人员/方向/基线/可用金额，记录分配；重复调用不增加金额。实现多笔部分到账及歧义返回待确认。
- [x] 为不同 ID 恢复、无父任务/无支付、超额/重复分配、冲正资金失效、旧包 absent 写失败测试。
- [x] 同时更新全部备份注册、schema/table 字段覆盖、portable references、分类标签、导出预览恢复和迁移顺序；确有排除字段需写理由，不能屏蔽覆盖检查。
- [x] 旧备份不含任务/分配时不删除目标任务，不猜测旧补扣全部未办；恢复不调用真实操作，也不把 awaiting 重置为 pending。
- [x] 分别创建旧结构与新结构测试库，验证兼容升级可重复运行、不改已有财务金额；新表纳入整库迁移顺序。

测试的关键断言：

```python
# 任务完成标记成功后，以下值必须与标记前完全相同。
assert after['due_amount'] == before['due_amount']
assert after['paid_amount'] == before['paid_amount']
assert after['difference'] == before['difference']
# 单个支付的所有任务分配和不得超过其实际有效金额。
assert sum(allocated_cents) <= abs(payment.amount_cents)
```

验证：

```bash
.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_meal_ticket_followup_backup.py tests/test_meal_tickets.py tests/test_meal_ticket_reconciliation.py tests/test_backup_coverage.py tests/test_multi_month_restore_preview.py tests/test_multi_month_restore.py tests/test_migration_service.py -q
```

**完成标准：** 新接口可用，操作声明与资金分离，关闭抵消有真实的两个方向义务，任务/分配可备份恢复，旧月份和旧包安全接入。阶段 5 才将核对全链路自动匹配接入业务入口。


### 阶段 2 固定的持久化契约（2026-10-10）

- ORM：`MealTicketFollowupTask` 保存 key/month/batch_key/item_key/kind/amount_cents/status/version/source_snapshot/offset_enabled/skip_order/operator/operation_at/created_at；`MealTicketFollowupAllocation` 保存 key/month/task_key/payment_key/amount_cents/operator/created_at。同任务/流水唯一，正整数分；本地 id 明确排除，全部关系以业务 key 移植。
- `MealTicketBatch.followup_state` 可空 JSON，保存 baselines（按 item_key 的已核实支付/调整 key 与金额、UTC 基线时点、初始剩余方向、说明和操作者）、requests（请求摘要与原结果）、offset_enabled/settings_digest、current_task_key、skip_sequence。退回草稿时用 baseline_reset 标记下一次重建基线；历史任务失效记录保留。请求结果存 batch_key，响应时绑定目标 batch_id，不能把源库 ID 写入可移植结果。
- progress 在 skip/complete/undo/retry 之外增加 `select`：仅选择 pending/skipped 当前任务，提交相同版本/幂等参数，持久化批次共享定位；操作历史保存 action/reason/operator/UTC 时间/request_digest。skip_order 为批次单调队尾序号，current_task_key 不是浏览器状态。
- refresh 可附 `baselines: {item_key: {recharge_cents, refund_cents, reason}}`。仅首次可靠基线缺失时使用，金额严格非负整数分，说明必填，两方向之差必须等于真实净差额；历史结清可直接显式刷新建立基线。旧历史调整被基线消费，不能再把全部历史正负值排队。
- GET 只读派生实际分配与状态，不写进度。清单返回 superseded 历史供查阅；阶段 4 办理队列仅使用 pending/skipped，awaiting/partial/verified 独立展示。retry 的 pending 金额使用 remaining_cents，冻结原来源及快照，不因设置切换再抵消已操作金额。
- 同请求键/内容/操作者重试返回原结果，换内容 409；请求摘要以 batch_key 绑定，版本和 settings_digest 保护写入。新的补扣来源出现后旧卡片拒绝办理，显式刷新才更新；版本、幂等、导航及资金分配同事务保存。
- `allocate_payment(task_key, payment_key, amount_cents, operator)` 只分配已有真实流水，不创建支付、不 commit。`payment_candidates(task_key)` 只返回可用支付 key/金额与 requires_confirmation，同额多笔/多任务保留待人工关联；`refresh_allocations(task_key)` 在业务事务内同步合法冲正后的状态。阶段 5 接入 reconcile/手工支付后必须调用同步函数；当前未接自动入口。
- 无真实操作/流水仍允许原退回草稿：未操作任务 superseded、定位清空，重算并重新确认后重建可靠基线；已有 awaiting/partial/verified 或保留外部操作时间的任务不能退回，未实际操作的声明可先 undo。普通月度支付原金额保护保持。
- 备份 V2 新增 meal_followup_tasks/meal_followup_allocations，meal_batches dataset version=2；接受旧 version=1 缺 followup_state，并保留目标字段。V1 codec 冻结，新范围 absent、不按缺失删除。导出与最终恢复状态共同校验来源/父记录、方向/月份/基线、任务义务金额、重复与超额分配、冲正失效、重办证据、导航和幂等 portable 引用；恢复不触发设备、不把已操作重置为待办。system_settings 继续整表排除。

## 阶段 3：月度发放页四阶段简化

**Files:**
- Modify: `frontend/src/pages/MealTicketPage.tsx`, `frontend/src/pages/meal-ticket.css`。
- Extend Test: `frontend/src/pages/MealTicketPage.test.tsx`, `frontend/src/pages/MealTicketPaymentCompatibility.test.tsx`, `frontend/src/pages/MealTicketReconciliation.test.tsx`。
- 必要时 Modify: `frontend/src/api/mealTickets.ts`（不更改现有 XLS 契约）。

**Interfaces:** 沿用 generate/confirm/unconfirm/export-recharge/reconcile，金额计算不搬到前端。新四阶段状态从批次、财务和当前核对状态派生。

- [x] 写无批次→计算、草稿→重算/核对、已确认→导出、核对成功/失败的失败测试。
- [x] 保留唯一月份控件；步骤条移除按钮，只显示状态。移除“前往导出”、重复核对按钮及独立“登记充值”步骤卡。
- [x] 将生成按钮按状态显示“计算菜票”或“重算草稿”；草稿核对区保留调整与本月不发；确认后不显示调整编辑。
- [x] 确认后只有一个真实 XLS 下载入口；重复下载合法，不写实际流水；同一个入口支持结清后重新下载。
- [x] 外部完成后同一主按钮启动核对，不添加单独“下一步”。数据库未开启时改为合法的实际登记路径，保留凭证/日期与原校验。
- [x] 已完成区域收起摘要；确认后合法退回草稿放当前区域低频操作，遵守服务端限制；源变化提示和异常处理保留。
- [x] 增加工号/金额 XLS、草稿重算保留调整、本月不发、负应发/锁定/版本的相关回归。

唯一入口测试写法（按当前测试初始化方法获取页面）：

```tsx
expect(screen.getAllByRole("button", { name: "重算草稿" })).toHaveLength(1);
expect(screen.queryByRole("button", { name: "前往导出" })).not.toBeInTheDocument();
expect(screen.getAllByRole("link", { name: /导出充值表/ })).toHaveLength(1);
```

在 `frontend` 工作目录：

```bash
npm test -- src/pages/MealTicketPage.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx src/pages/MealTicketReconciliation.test.tsx
npm run build
```

```bash
.venv-mac/bin/python -m pytest tests/test_meal_tickets.py tests/test_meal_ticket_rules_migration.py tests/test_backup_coverage.py -q
```

**完成标准：** 四阶段页面可用，计算重算下载均存在，无重复入口，确认后补扣仍只在后续页，后续页暂保持原布局直到阶段 4。

## 阶段 4：后续补扣页与逐人办理卡片

**Files:**
- Modify: `frontend/src/pages/MealTicketPage.tsx`, `frontend/src/pages/meal-ticket.css`, `frontend/src/api/mealTickets.ts`。
- Create: `frontend/src/components/MealFollowupQueue.tsx`, `frontend/src/components/MealFollowupQueue.test.tsx`。
- Extend Test: `frontend/src/pages/MealTicketPage.test.tsx`, `frontend/src/components/MealAdjustmentImport.test.tsx`。
- 保留: `frontend/src/components/MealAdjustmentImport.tsx` 现有导入能力，除对接刷新所需行不改。

**Interfaces:** 消费阶段 2 任务 API；服务端金额是办理依据。新组件承载当前任务卡片、选择任务、复制及进度，父页保留调整/核对入口。

- [x] 写按工号定位、前导零、正数两位金额、复制成功/失败、单人补发/取款的失败测试。
- [x] 实现三阶段展示，保留单人/批量/导入调整；取消手动下一步与后续导出充值表。
- [x] 表单方向选择转换为服务端 signed amount；不在人员名单另放第二套办理按钮。
- [x] 接入“复制工号”“复制金额”“暂时跳过”“已完成充值/取款，下一人”；只有服务端标记保存成功才切下一人，失败留原人员。
- [x] 当前清单固定排序，名单支持搜索/选择，计数用项；刷新或离页恢复任务进度，已操作进入待核对区。
- [x] 全局设置改变提示刷新，不在此页重复开关。金额变化提示重建清单，旧卡片不能提交。
- [x] 核对后的剩余差额/异常展示；待确认重办有说明，不能把尚未到账直接当需再次充值。
- [x] 人员详情保留调整/流水历史与合法冲正，未确认月份提示先月度核算。

复制与资金分离的前端验收：

```tsx
expect(clipboard.writeText).toHaveBeenCalledWith("00123");
expect(clipboard.writeText).toHaveBeenCalledWith("24.00");
// 标记下一人只调用 progress API；不能触发 payment 或 recharge API。
expect(paymentMock).not.toHaveBeenCalled();
```

在 `frontend` 工作目录：

```bash
npm test -- src/components/MealFollowupQueue.test.tsx src/pages/MealTicketPage.test.tsx src/components/MealAdjustmentImport.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx
npm run build
```

```bash
.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_backup_coverage.py -q
```

**完成标准：** 按工号逐人办理、跳过继续、抵消切换刷新、待核对可用，无后续充值表/批量设备操作，无操作标记误写金额。

## 阶段 5：核对到账与分别办理的完整闭环

**Files:**
- Modify: `services/meal_ticket_followup_service.py`, `services/meal_ticket_service.py`, `services/meal_ticket_reconciliation.py`, `routes/meal_tickets.py`。
- Modify: `frontend/src/pages/MealTicketPage.tsx`, `frontend/src/components/MealFollowupQueue.tsx`, `frontend/src/api/mealTickets.ts`。
- Test: `tests/test_meal_ticket_followup.py`, `tests/test_meal_ticket_reconciliation.py`, `tests/test_meal_tickets.py`, `frontend/src/pages/MealTicketReconciliation.test.tsx`, `frontend/src/pages/MealTicketPaymentCompatibility.test.tsx`。
- 如字段/关系变更：阶段 2 的备份文件及测试同步更新。

**Interfaces:** 数据库核对完成后在同一事务调用任务分配服务；返回任务结果或由前端读取最新任务列表。实际手工支付可带 task_key，但仅验证后的方向余额允许分别支付。

- [x] 测试抵消开启 40/-16→24，到账 10→剩余 14；关闭 40/-16→充值 40、取款 16，先后两种顺序均合法。
- [x] 测试关闭 24/-24：财务净差额零但尚未办理，不提前显示任务完成；开启时无需办理。
- [x] 为 task_key 手工支付增加方向/人员/版本/余额校验，不带任务的普通支付仍不能超过净待发/待扣回。
- [x] 数据库只读核对继续按来源去重；任务分配不创建第二份支付，不把原有月度大额充值重复分配为本次补发。
- [x] 测试部分/延迟流水、多笔同额歧义、跨月结束日期、重复核对、旧流水、并发、错误来源；歧义人工确认关联必须验证剩余可分配金额。
- [x] 扣回/清零分类仅一个区域；确认分类自动继续核对，清零绝不核销扣回任务。
- [x] 手工/数据库混用保护、禁用数据库、冲正限制保持原规则；已手工任务不会再次分配数据库同款。
- [x] 冲正实际支付后更新分配与任务剩余，保留历史；撤销进度标记不改变真实支付。
- [x] 同事务验证账目/任务一致性和失败全部回滚，核对失败 UI 保持上次实际金额与 awaiting 状态。

资金闭环关键算例（已结清基线 176 元）：

```text
新增 +40/-16，应发=200。
关闭抵消，先充值40：净已发216，净差额-16，充值任务完成、取款任务待办。
再取款16：净已发200，净差额0，两个任务完成。
先取款16：净已发160，净差额40；再充值40，同样完成。
普通无任务支付不得任意充值40或取款16绕过现有金额限制。
```

```bash
.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_meal_ticket_reconciliation.py tests/test_meal_tickets.py tests/test_meal_ticket_followup_backup.py tests/test_backup_coverage.py -q
```

在 `frontend` 工作目录：

```bash
npm test -- src/pages/MealTicketReconciliation.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx src/components/MealFollowupQueue.test.tsx
npm run build
```

**完成标准：** 两种抵消模式从调整到外部办理、真实流水、任务核销均可用，部分到账与取款分类可恢复，不重复记账或重复提示办理。

## 阶段 6：完整验收与交付

**Files:**
- 扩展前述测试中缺失的真实集成场景；业务文件只为修复本范围验收缺陷修改。
- Create: `docs/meal-ticket-workflow-user-guide.md`。
- Update: 本计划、Spec、handoff 执行记录及必要导航描述（仅改与最终行为不符的文字）。

- [x] 运行完整 Python 测试、前端完整测试、构建。首次收集基线失败与本次引入失败分开记录；不得用已有失败掩盖相关失败。

```bash
.venv-mac/bin/python -m pytest -q
```

在 `frontend` 工作目录：

```bash
npm test
npm run build
```

- [x] 在隔离测试数据/本地预览实际走一遍月度计算→重算→确认→XLS→核对；下载不算到账。
- [x] 实际走抵消开启与关闭、逐人充值/取款、跳过继续、切换月份、重载、两管理员冲突、部分到账/延迟、重办确认。
- [x] 实际恢复含任务/分配的跨月备份到不同 ID 测试库，确认不会发起设备操作；恢复旧包缺任务不删除目标业务。
- [x] 验证 schema 覆盖与资金一致性；如项目已有可用 MySQL 测试配置，按既有测试入口验证新增模型外键与升级，不接触生产库。
- [x] 明确旧月份初次接入步骤与无法可靠判断已办理的提示，写用户指南；说明安装级开关不随月度备份覆盖、业务清单使用历史快照。
- [x] 检查所有步骤重复入口已去除；完成后资料/历史/必要重新下载仍可获取；确认后调整只能在后续页。
- [x] 审查 git diff 是否仅限本范围；记录测试结果、剩余限制、提交与否、当前分支，生成最终交接文案。

**完成标准：** 所有阶段完成且相关验证通过；无法运行的真实数据库/UI验证明确写未验证，不将它描述为通过。

## 执行进度

- [x] 阶段 1：设置与契约
- [x] 阶段 2：持久化任务与备份
- [x] 阶段 3：月度发放页
- [x] 阶段 4：后续补扣页
- [x] 阶段 5：核对联调
- [x] 阶段 6：验收交付（隔离软件验收完成；真实外部流水库、设备和生产环境未验证）

## 执行记录

2026-10-10：已只读检查现有页面、更多设置 API、净额支付校验、数据库流水核对与备份注册；完成 Spec、本计划、handoff 文案。工作开始时 git 工作区干净。尚未运行实施验证，尚未修改业务代码、数据库或提交。

每阶段追加记录格式：

```text
阶段与状态：
实际改动文件：
固定/变更的接口与模型字段：
验证命令和实际结果：
未解决问题与未运行的检查：
当前分支、提交哈希或未提交状态：
下一阶段（失败时仍为当前阶段）：
下一对话复制文案（填入真实状态，不留占位符）：
```

最终助手回复必须包含：完成结果、验证结果、未解决事项，以及完整可复制的新对话文案；不能只说“接下来做阶段 N”。


### 2026-10-10 阶段 1：完成

- 开始状态：master / 8561b684286f2356de5d233fb373aa637504b3e4，业务代码干净，三份方案文档未跟踪；执行进度全部未勾选，没有更早的实施阶段需补完。
- task-start：阶段 1，BASE 8561b68。按用户指定目录内联实施，保留未提交工作；不创建子代理、不自动推进。本计划执行记录作为逐阶段持久交接记录。
- Pre-flight：阶段 1→2 的金额投影/开关、阶段 1→4 的设置展示、阶段 2→5 的分配和任务支付存在共同接口；已核对 Spec。普通支付仍受净额限制，关闭抵消不能只改前端。阶段 2 建任务及分配，阶段 5 接入资金入口，职责无冲突。旧月份可靠基线与 portable key 规则已固定在上方契约。
- 实际代码文件：frontend/src/api/admin.ts、frontend/src/pages/admin/MoreSettingsPage.tsx、frontend/src/pages/admin/MoreSettingsPage.test.tsx、routes/api_admin.py、tests/test_api_admin.py；新增 services/meal_ticket_followup_service.py、tests/test_meal_ticket_followup.py。文档更新本计划、Spec 状态和 handoff；月度/后续补扣页面及支付服务未修改。
- 具体行为：独立 PATCH 语义的 PUT，严格布尔、全部验证后保存；页面保持已保存值直至成功，失败保持原值；保存期间两开关暂时禁用以避免本页并发响应覆盖。新开关卡片紧接异常扣除卡片，仅一个入口，并明确后续逐人办理启用后生效。
- 接口/模型：新增配置键 meal_ticket_offset_enabled，缺失 true；MoreSettings 增加布尔字段，saveMoreSettings 改为 Partial<MoreSettings> 对象参数，唯一调用页已同步。新增纯金额函数；无 ORM 表/字段/关系/业务意义变更，无数据库升级。SystemSetting 安装级新键沿用已注册整表排除理由（凭证风险），不进入月度备份；任务历史设置快照在阶段 2 纳入备份。
- 基线：`.venv-mac/bin/python -m pytest tests/test_api_admin.py tests/test_backup_coverage.py -q` → 34 passed；`npm test -- src/pages/admin/MoreSettingsPage.test.tsx` → 3 passed。
- RED：新增 API 定向测试 2 failed / 1 passed（缺少默认字段、非法抵消值被接受）；投影 28 failed（缺少模块）；设置页 3 failed / 2 passed（缺新开关及旧标量请求不符合部分更新契约）。API 定向命令使用 -k more_settings，会 deselect 投影测试，已单独运行全部投影用例，未用 deselect 当通过。
- GREEN：`.venv-mac/bin/python -m pytest tests/test_api_admin.py tests/test_meal_ticket_followup.py tests/test_backup_coverage.py tests/test_meal_tickets.py -q` → 122 passed in 23.46s。
- GREEN（frontend）：`npm test -- src/pages/admin/MoreSettingsPage.test.tsx` → 5 passed；`npm test -- src/pages/admin/MoreSettingsPage.test.tsx src/api/admin.test.ts` → 6 passed。
- GREEN（frontend）：`npm run build` → exit 0；仍有压缩后 chunk >500 kB 的体积提示，未因该提示修改无关代码。`git diff --check` → exit 0。
- Final review：依照 code-review 和 verification-before-completion 内联自审（用户指定不用子代理），未发现本阶段阻断项。确认每个业务改动均对应阶段 1，没有提前接入后续资金业务。
- 未解决事项/限制：没有阶段 1 测试失败；未运行全套 Python/前端测试、真实 MySQL 升级、浏览器人工验收。纯投影中的“到账 10 后剩余 14”仅验证输入为剩余义务后的输出，真实流水扣除/保留 awaiting 由阶段 2、5 验证，不能把本阶段投影通过等同真实核销已实现。
- task-done：阶段 1 完成，未创建提交。当前 master / 8561b684286f2356de5d233fb373aa637504b3e4，原三个文档及新增 service/test 未跟踪，其余阶段 1 代码修改未提交；未推送、未发布、未操作生产数据。
- 下一阶段：仅阶段 2 持久化任务、进度与备份；具体复制文案如下，handoff 同步存档。

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化阶段 2：持久化任务、进度、资金分配与备份。
先读 AGENTS.md、docs/design/2026-10-10-meal-ticket-workflow-design.md、docs/design/2026-10-10-meal-ticket-workflow-plan.md、docs/design/2026-10-10-meal-ticket-workflow-handoff.md；检查 git 状态和执行记录，先补最早未完成阶段，不跳过、不重做完成阶段。
阶段 1 已完成：/admin/more-settings 新增默认开启的“补发与扣款抵消”；GET/PUT /api/admin/more-settings 返回两个布尔字段，PUT 独立部分更新，旧异常扣除请求兼容；新增 project_pending_amounts(recharge_cents, refund_cents, offset_enabled)，严格非负整数分和布尔输入，输出正金额方向。后续 HTTP、状态转换、版本/幂等、基线和 portable key 契约已固定在计划“阶段 1 固定的后续契约”。本阶段未新增/修改业务 ORM；system_settings 仍整表排除月度备份。
真实验证：Python 阶段 1 相关测试加 test_meal_tickets 共 122 passed（含 test_backup_coverage）；设置页 5 passed，连同 api/admin 测试共 6 passed；npm run build 成功，仅大包体积提示；git diff --check 通过。未运行全套测试、真实 MySQL 或浏览器人工验收；目前无阶段 1 未解决失败。后续接口/模型尚未实现，新开关尚未接入办理页面。
提交状态：master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1 代码未提交，三份原方案文档及新增 service/test 仍为未跟踪文件，保留并承接，勿覆盖或重复实现。
本次授权修改代码，仅完成阶段 2，按 executing-plans 内联执行，不用子代理；不自动推进阶段 3，不推送、不发布、不操作生产数据。实现任务/进度/真实分配后端，设置变化只刷新未操作任务；已操作不等于到账，不能重发历史。新增 ORM 同阶段完成备份注册、字段映射、导出、预览、恢复、依赖/资金校验、旧包 absent 兼容和整库迁移；导航与跳过顺序持久化字段也须覆盖。自动核对/手工支付入口联调按计划留阶段 5，不提前改月度或后续页布局。
保留全部已确认需求：月度计算/重算/XLS 导出；确认后补扣只在后续页；充值/取款按字符串工号逐人办理；抵消默认开启且开关仅在项目更多设置；操作进度与实际到账分离；每个操作唯一入口。
先写有意义的失败测试再实现，运行阶段 2 计划验证和 tests/test_backup_coverage.py，更新复选框及执行记录；报告真实结果、限制、提交状态，给出可复制的阶段 3 启动文案后停止。若未完成或验证失败，给出继续阶段 2 的文案，不声称完成。
```

### 2026-10-10 阶段 2：完成

- task-start：阶段 2，BASE 8561b68；核对阶段 1 已完成和未提交工作区后承接。用户明确内联、不用子代理，仅本阶段；沿用当前 master 工作区，不创建提交。计划执行记录继续作为 ledger。
- Pre-flight：阶段 2→4 消费 GET/refresh/progress；阶段 2→5 消费实际分配和候选关联。设置变化只重建尚未外部操作任务；普通支付限制保持，阶段 5 才接入口。业务任务、导航、幂等记录与 portable 资金关系同阶段备份，无跨阶段遗漏。
- Ruling：增加 MealTicketBatch.followup_state JSON，保存基线、请求结果、当前 task key、跳过计数和清单设置快照；Task.skip_order 保存队尾顺序，progress 增加 select 行为。这样阶段 4 可服务端恢复主动选择，且无需第三张导航表。代价：导航为批次共享，不是每个管理员独立偏好。
- Ruling：首次未结清月份 refresh 通过可选 baselines[item_key]={recharge_cents, refund_cents, reason} 明确确认可靠剩余方向，并强制方向之差等于实际净差额；结清月份显式 refresh 记录实际账及历史调整基线，不重排旧记录。代价：旧月份历史分开金额由管理员核实，服务端无法从没有消费关系的历史账自动证明。
- Ruling：新增任务/分配只注册 V2；V1 codec 保持冻结。meal_batches dataset version 升为 2，旧 version 1 缺 followup_state 保持 absent 字段，不补空值；新数据集缺失保持 absent 范围。代价：旧 V1 导出不能携带新任务，当前多月 V2 导出携带完整业务状态。
- RED：原有 28 个投影用例通过；新增 4 个业务用例因缺 followup API/allocate_payment 失败；9 个备份、升级用例因缺 ORM 模型失败。
- RED→GREEN 边界：关闭抵消时完成单方向不能消费另一方向、无变化 refresh 保留 skipped key、零净额后改为分别办理、partial retry 后切换设置仍可办理，均先观察失败再修复。夹具跨 app_context 读取过期 ORM 对象修正为在新会话重新加载；跨库测试补足既有月度快照依赖，没有绕开依赖校验。
- 中间验证：阶段 2 计划命令 185 passed in 14.69s（随后继续补测试，非最终结果）；任务定向 40 passed；备份/迁移定向 13 passed。后续以最终验证记录为准，尚未标完成。

- 生命周期补充 RED→GREEN：无实际支付但 awaiting 的任务阻止退回草稿；pending/skipped 在合法退回时失效、清空定位；退回后导出仍可校验历史，重算并重新确认后按新应发建立清单。两个用例先失败后修复，未放宽普通支付或改页面。
- Final review：依照 code-review 内联自审（用户明确不用子代理）。补齐义务金额与来源匹配、畸形来源/导航、已有部分资金不得无 retry 恢复为 pending、任务缺清单基线、退回草稿保护；各缺陷有失败测试再修复。未发现本阶段剩余阻断项；自审不能等同独立审查。
- 最终阶段 2 计划验证：`.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_meal_ticket_followup_backup.py tests/test_meal_tickets.py tests/test_meal_ticket_reconciliation.py tests/test_backup_coverage.py tests/test_multi_month_restore_preview.py tests/test_multi_month_restore.py tests/test_migration_service.py -q` → **204 passed in 16.73s**。
- 前端相关验证：`npm test -- src/components/admin/AccountSetBackupModal.test.tsx src/pages/admin/MoreSettingsPage.test.tsx src/api/admin.test.ts` → **26 passed**；`npm run build` → exit 0，仍有 >500 kB 大包提示。仅扩充备份分类/字段标签和标签断言，没有改月度或后续页布局。
- 升级/恢复验证：旧结构删除本次新表/字段后兼容升级重复两次，实际支付金额不变；新结构 create_all、跨 ID 且启用 FK 的目标库、ZIP 往返、V1/V2 absent 与部分到账恢复通过。整库迁移实际路径在隔离 SQLite 源/目标复制了新表、资金和 JSON 定位；未运行真实 MySQL。
- Ruling：将任务生命周期保护接入原 unconfirm，只增加任务校验/安全失效，不接支付/核对入口。否则纯操作声明会被退回和草稿重算覆盖，产生重复办理风险。代价：已有外部操作声明须先核对或合法撤销，不能立即退回草稿。
- 实际阶段 2 文件：models/meal_ticket.py；routes/meal_tickets.py；services/meal_ticket_followup_service.py、meal_ticket_followup_validation.py、meal_ticket_service.py（仅 unconfirm 任务保护）、bootstrap_service.py、migration_service.py、account_set_backup_schema.py、account_set_backup_service.py、backup_document.py、multi_month_restore_preview.py、multi_month_restore.py；tests/test_meal_ticket_followup.py、test_meal_ticket_followup_backup.py、test_migration_service.py；frontend/src/components/admin/backupLabels.ts、AccountSetBackupModal.test.tsx；三份方案文档。原阶段 1 未提交代码保留。
- 限制：未运行全套后端/前端、真实 MySQL 升级或迁移、浏览器人工验收；旧数据的独立方向须管理员提供可靠剩余基线；全局设置不随业务备份覆盖，定位为批次共享。自动核对/手工 task_key 支付联调仍留阶段 5；当前普通支付不能用两个净额外任务绕过保护，这不是已实现的完整关闭抵消支付流程。

- 最终联合验证（当前代码）：`.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_meal_ticket_followup_backup.py tests/test_meal_tickets.py tests/test_meal_ticket_reconciliation.py tests/test_backup_coverage.py tests/test_multi_month_restore_preview.py tests/test_multi_month_restore.py tests/test_migration_service.py tests/test_account_set_backup.py tests/test_account_set_backup_api.py tests/test_backup_document.py tests/test_multi_month_backup.py tests/test_backup_account_state.py tests/test_backup_shared_data.py tests/test_monthly_backup_acceptance.py tests/test_api_admin.py -q` → **365 passed in 55.87s**。含计划集全部 204 项；补充 161 项备份/API 回归。最终 `git diff --check` → exit 0。
- task-done：阶段 2 完成；未创建提交，master / 8561b684286f2356de5d233fb373aa637504b3e4。无未解决测试失败；阶段 1 与阶段 2 的未提交/未跟踪文件均保留。未推送、未发布、未操作生产数据。下一阶段仅阶段 3，复制文案同步 handoff；到此停止。

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化阶段 3：月度发放页四阶段简化。
先读 AGENTS.md、docs/design/2026-10-10-meal-ticket-workflow-design.md、docs/design/2026-10-10-meal-ticket-workflow-plan.md、docs/design/2026-10-10-meal-ticket-workflow-handoff.md；检查 git 工作区和执行记录，从最早未完成项继续，不跳过、不重做已完成阶段。

阶段 1、2 已完成。阶段 1 的默认开启抵消开关和纯金额投影保留。阶段 2 已实现管理员 GET /api/meal-tickets/followup-tasks、POST /followup-tasks/refresh、POST /followup-tasks/<task_key>/progress；GET 只读，批次/任务版本、设置摘要及请求键保护写入。操作声明不写支付；awaiting/partial/verified 不因设置刷新重排，retry 必填原因且只办 remaining_cents。progress 增加 select，定位按批次共享。
新增 MealTicketFollowupTask、MealTicketFollowupAllocation；批次 followup_state 保存可靠基线、可移植幂等结果、current_task_key、skip_sequence、清单快照和 baseline_reset；Task.skip_order 保存队尾顺序。旧月份 refresh 可显式 baselines[item_key]={recharge_cents, refund_cents, reason}，净差额校验后建立基线，历史已支付调整不再入队。资金服务 allocate_payment / payment_candidates / refresh_allocations 已有部分到账、方向/人员/基线/可用金额、重复/超额与冲正保护；阶段 5 才接自动核对/手工支付，普通支付保护没有放宽。
V2 备份包含任务、分配与导航；meal_batches dataset version=2，旧 version=1 缺字段和旧 V1/V2 缺数据集保持 absent，不删除目标、不重置待核对进度。V1 不携带新任务；system_settings 仍整表排除。兼容升级与整库迁移排序已同步。已声明外部操作的任务阻止退回草稿；无操作的原合法退回仍保留，并使旧清单失效、下次重新建立基线。

真实验证：阶段 2 计划 8 个测试文件共 204 passed；加备份/API 回归的 16 文件最终联合命令共 365 passed in 55.87s，含 tests/test_backup_coverage.py。前端 AccountSetBackupModal、MoreSettingsPage、api/admin 共 26 passed；npm run build exit 0（仍有 >500 kB 大包提示）；git diff --check 通过。实际验证隔离 SQLite 旧结构重复升级、新结构、整库迁移路径、启用 FK 的不同 ID 目标恢复、真实 ZIP 往返、旧包 absent。内联自审，无阶段 2 未解决失败；未跑全套后端/前端、真实 MySQL 升级迁移或浏览器人工验收。
提交状态：master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4，阶段 1、2 均未提交；三份设计文档和新增 service/test 仍未跟踪，保留并承接，勿覆盖。没有推送、发布或生产数据操作。

本次授权修改代码，仅完成阶段 3，按 executing-plans 内联执行，不用子代理，不自动推进阶段 4，不推送、不发布、不操作生产数据。月度流程改为选月份→计算与核对→导出并充值→核对到账；保留计算、重算草稿、确认核算、两列 XLS、来源/锁定/负应发校验、低频合法退回和结清后重新下载。唯一月份控件，步骤条无按钮，每个操作一个入口；下载不是实际到账。确认后补扣仍只在后续页，本阶段不改后续页布局、不提前接阶段 5 的资金入口。
保留所有已确认需求：月度计算/重算/XLS；确认后补扣只在后续页；充值/取款按字符串工号逐人办理；抵消默认开启且开关仅在项目更多设置；操作进度与实际到账分离；每个操作唯一入口。
先写有意义的失败测试再实现，运行阶段 3 计划验证和 tests/test_backup_coverage.py。业务 ORM 若变化，同阶段更新备份全链路。更新复选框/执行记录，报告真实结果、限制、提交状态，生成阶段 4 复制文案后停止；未完成或验证失败则提供继续阶段 3 文案，不声称完成。
```


### 2026-10-10 阶段 3 执行记录（完成）

- task-start：阶段 3，BASE 8561b68；检查 AGENTS.md、设计、计划、handoff 与 git，阶段 1、2 已完成且未提交，从阶段 3 首项继续。按用户授权在指定 master 工作区承接，不创建子代理，不推进阶段 4。沿用本执行记录作为 ledger。
- Pre-flight：月度与后续页共享批次/实际支付/核对面板和表单；本阶段仅重排月度入口与展示，后续页仍保留原步骤、日期控件、分类按钮和人员区 DOM（使用 Fragment）。阶段 2 任务接口与资金分配入口不接入、不改变。
- RED：三份前端计划测试首次有效运行 70 项，11 failed / 59 passed，失败证据包含四阶段标题、计算入口、步骤条无按钮、结清后下载。另观察分类合并、部分到账状态、草稿重算金额变化、完成区域折叠/上月考勤和手工模式结清折叠的失败测试；逐次修复后联合转绿。最初 npm 命令误在根目录执行 exit 254，随后改在 frontend 执行，未计为有效 RED。
- 实现：月度四阶段固定；顶部月份唯一，无批次也显示对应上月考勤。计算菜票/重算草稿、确认核算移出步骤条，草稿编辑保留。重算对服务端返回的前后应发做展示比较，不把核算搬到前端；按人员显示金额变化。
- 实现：确认后保留唯一两列 XLS 下载入口，下载不修改状态/资金，不添加导出时间；进入核对或结清时下载区域收为资料摘要，仍可重复下载。完成的人员核算区域默认折叠，核对差额或手工实际登记区域展开，结清后可按需展开明细。
- 实现：数据库模式同一主按钮首次“已完成充值，核对到账”，有实际金额/支付历史/核对报告/失败结果后改为“核对到账”；点击直接核对，无独立下一步。月度取款分类提交合并进此按钮，后续页保留原分类入口。结束日期按需展开，原日期校验与服务器保护保留。失败不覆盖账目，导航变化后的旧核对响应不覆盖新页。
- 实现：数据库未启用时保留合法单人/选中人员实际登记，凭证/实际日期/请求键和失败重试保留，登记后直接刷新差额、自动结清，不再额外点重新核对。已由数据库登记但开关关闭的批次仍暂停，不允许手工重复登记。合法退回作为低频文字入口保留，支付历史/后续重算限制及服务端拒绝提示保留。
- Ruling：沿用用户指定未提交工作区与计划执行记录，不创建隔离 checkout、提交或子代理评审 — 用户明确要求承接阶段 1、2 未提交成果并内联执行 — 代价是最终审查为作者自审。
- Ruling：取款分类沿用月度唯一核对按钮；尚未选择分类时允许重新读取，部分分类选择未完成时禁用提交，全部分类后同一按钮发送 refund_actions — 保留失败重试和明确分类能力，同时消除重复入口。后续页的原分类按钮保持不变。
- Ruling：保留原“写入处理中导航，完成后加载目标月”的兼容行为，不扩展为即时切换；给核对返回增加月份/导航归属保护 — 避免本阶段改变普通支付的等待契约。初稿测试要求即时切换被现有支付回归否定，恢复原行为并更新新核对测试，现有支付回归无需改写。
- ORM/接口：本阶段未改变业务表、字段、关系、含义、HTTP 接口或 XLS 格式；不需要新增备份数据映射，阶段 2 备份成果完整保留。本阶段对 tests/test_meal_tickets.py 增补重复真实 XLS 导出并断言前后整个批次/支付一致。
- 最终验证（frontend）：`npm test -- src/pages/MealTicketPage.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx src/pages/MealTicketReconciliation.test.tsx` → **73 passed**，3 文件；`npm run build` → **exit 0**，仅既有 >500 kB 大包体积提示。
- 最终验证（项目根目录）：`.venv-mac/bin/python -m pytest tests/test_meal_tickets.py tests/test_meal_ticket_rules_migration.py tests/test_backup_coverage.py -q` → **64 passed in 7.18s**。包含字符串工号/两列 XLS、重复导出不写资金、重算保留调整与不发、来源/锁定/异常/负应发/版本/合法退回与备份覆盖回归；`git diff --check` → **exit 0**。
- Final review：按 code-review/code-reviewer 清单做独立内联自审（用户禁止子代理），发现手工模式结清后仍展开明细，补失败断言并修复；最终联合验证通过，无阶段 3 未解决失败。自审不等于独立 reviewer 或浏览器验收。
- 未运行：全套后端/前端测试、真实 MySQL、浏览器人工验收；本阶段不宣称整项改造或阶段 5 资金联调已完成。
- task-done：阶段 3 完成，阶段 4–6 未实施。master / 8561b684286f2356de5d233fb373aa637504b3e4，未创建提交；阶段 1、2、3 未提交/未跟踪成果保留，无推送、发布或生产数据操作。以下文案同步 handoff，提供后停止。

阶段 4 复制文案：

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化阶段 4：后续补扣页逐人操作。

先读 AGENTS.md 和 docs/design/2026-10-10-meal-ticket-workflow-design.md、docs/design/2026-10-10-meal-ticket-workflow-plan.md、docs/design/2026-10-10-meal-ticket-workflow-handoff.md；检查 git 工作区与执行记录，从最早未完成项继续，不跳过、不重做已完成工作。

阶段 1、2、3 已完成。阶段 3 月度页固定为选月份→计算与核对→导出并充值→核对到账；月份控件唯一并显示上月考勤，步骤条无按钮，计算/重算/确认/XLS 各一个入口。草稿重算显示前后应发变化，保留补扣和本月不发；确认后补扣只在后续页。下载不推进状态、不写流水；核对按批次/实际金额/流水/报告/失败状态派生，同一按钮首次“已完成充值，核对到账”、之后“核对到账”，月度取款分类也经此按钮提交。跨月结束日期按需展开，合法退回、手工真实日期/凭证/幂等登记、结清摘要/明细/原入口重复下载保留。后续页布局仍保持阶段 3 前的流程，待阶段 4 改造。
阶段 3 未改业务 ORM、HTTP 接口和 XLS 契约，未提前接阶段 5 的资金入口。阶段 2 的 GET followup-tasks 只读；refresh/progress 有批次/任务版本、settings_digest、request_key 保护，progress 支持 select/skip/complete/undo/retry。批次 followup_state 保存基线、幂等结果、current_task_key、skip_sequence 和清单快照，任务 skip_order 保存队尾顺序；具体请求/响应与 portable key 见计划固定契约。操作声明不写支付，awaiting/partial 不因设置刷新重排，retry 必填原因且只办 remaining_cents；不能重排所有旧历史。资金分配服务已有，但自动核对/手工 task_key 支付联调留阶段 5，普通支付保护未放宽。两张新表与 followup_state 的备份/恢复/旧包 absent/升级/迁移已在阶段 2 覆盖。

阶段 3 真实验证：frontend 下 npm test -- src/pages/MealTicketPage.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx src/pages/MealTicketReconciliation.test.tsx：73 passed；npm run build exit 0，仅既有 >500 kB 大包提示。项目下 .venv-mac/bin/python -m pytest tests/test_meal_tickets.py tests/test_meal_ticket_rules_migration.py tests/test_backup_coverage.py -q：64 passed。git diff --check 通过。已观察四阶段/唯一入口/折叠/重算变化等失败测试，再实现转绿；真实 XLS 重复导出不改批次与支付。内联自审，无阶段 3 未解决失败；未运行全套后端/前端、真实 MySQL 或浏览器人工验收。
提交状态：master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1、2、3 均未提交，三份文档与新增 service/test 仍未跟踪，请保留承接。未推送、未发布、未操作生产数据。

本次授权修改代码，仅完成阶段 4，按 executing-plans 内联执行，不用子代理；不自动推进阶段 5，不推送、不发布、不操作生产数据。后续页实现登记补扣→逐人办理→核对结果，取消手动下一步。按字符串工号保留前导零，复制工号、正数两位金额；仅当前任务卡片提供跳过/已完成充值或取款下一人，下方名单只切换当前任务。接入服务端清单和持久化定位/跳过顺序，办理队列只用 pending/skipped；awaiting/partial/verified 单独展示，切换页面/刷新可继续。保留单人/批量登记补扣、表格导入、考勤重算/补入、调整历史和合法更正；后续页不导出充值表、不批量充值取款。抵消默认开启且开关仅在更多设置，当前页只显示模式/变更提示；操作进度与真实到账严格分离，不把延迟流水提示为再次充值，不用 localStorage 代替业务状态。不提前放宽支付或接阶段 5 资金入口。

先写有意义的失败测试再实现，运行阶段 4 计划验证及 tests/test_backup_coverage.py；ORM 若变化，同阶段完成备份全链路。更新复选框和执行记录，报告真实结果、限制及提交状态，提供阶段 5 复制文案后停止。未完成或验证失败则继续阶段 4，不声称完成。
```

## 2026-10-10 阶段 4 执行记录（已完成）

- task-start：阶段 4，BASE 8561b68；检查工作区、AGENTS、Spec、计划和 handoff，阶段 1–3 已完成并保留全部未提交成果。使用 executing-plans/TDD/verification-before-completion 内联执行。
- Pre-flight：阶段 4 消费阶段 2 GET/refresh/progress（含 select）、服务端当前定位和顺序；实际资金入口留阶段 5。无接口冲突。
- Ruling：按用户指定在 master 当前工作区承接；执行记录作为 ledger，使用内联自审，不创建工作树、子代理或提交。代价：没有隔离分支或独立审查者，交付时明确说明。
- 已批准的设计继续有效，不重复设计审批；只办理 pending/skipped，awaiting/partial 单独核对；任务金额采用 remaining_cents。保存补扣、导入、考勤重算和补入后读取任务摘要，可靠基线存在时刷新尚未操作清单；旧月缺基线只提示先核对，不自动猜测历史方向。
- RED：新增卡片 7 项在空组件上全部失败（复制、工号、金额、充值/取款、幂等重试、定位/跳过、设置/部分到账、旧月基线）；新增页面三阶段用例因没有逐人卡片失败。随后实现转绿。
- 原用例调整：旧后续页“下一步”和两阶段预期与已批准阶段 4 设计冲突，更新为三阶段只读步骤及自动摘要；保留月度批量实际登记的原进度/请求键覆盖，后续实际登记移至人员详情。导入测试继续确认只写调整，确认回调携带新批次版本。
- Ruling：保留现有净差额手工实际流水入口及数据库核对/取款分类，入口集中于详情/核对结果；本阶段不传 task_key、不接资金分配。代价：关闭抵消的分别真实充值/扣回、旧月剩余方向确认及新真实流水到任务的关联仍依赖阶段 5，不能声称资金闭环完成。
- GREEN（计划前端）：`cd frontend && npm test -- src/components/MealFollowupQueue.test.tsx src/pages/MealTicketPage.test.tsx src/components/MealAdjustmentImport.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx` → 4 files / 69 passed（5.28s）。
- GREEN（计划后端）：`.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_backup_coverage.py -q` → 50 passed（2.49s）。本阶段未改 ORM、HTTP 或 XLS 契约，备份全链路沿用阶段 2。
- 构建：`cd frontend && npm run build` → exit 0；仅既有 >500 kB 大包提示。`git diff --check` → exit 0。
- Final review：self-review（用户明确不使用子代理）；审查阶段 4 页面、组件、API 类型与既有权限/资金/备份边界。修正全部发现：批量保存期间清单刷新竞态、迟到复制提示、首次读取失败无法恢复、父页版本领先旧卡仍可提交、查询账号错误结清提示、迟到刷新覆盖新补扣；对应新增失败用例均先 RED 后 GREEN。无遗留阶段 4 失败或 deferred minors。

- 全套验证：`cd frontend && npm test` → 55 files / **488 passed**（10.94s）；`.venv-mac/bin/python -m pytest -q` → **936 passed**（259.50s），包含 `test_backup_coverage.py`。前端最终构建 exit 0。
- 实际阶段 4 文件：frontend/src/api/mealTickets.ts；frontend/src/components/MealFollowupQueue.tsx、MealFollowupQueue.test.tsx、MealAdjustmentImport.test.tsx；frontend/src/pages/MealTicketPage.tsx、MealTicketPage.test.tsx、MealTicketPaymentCompatibility.test.tsx、MealTicketReconciliation.test.tsx、meal-ticket.css；三份设计/计划/交接文档。后端与阶段 1–3 既有成果保留，本阶段未再改动。
- 限制：未运行真实 MySQL、浏览器人工验收或外部设备资金联调。采用内联自审而非独立审查；净额实际流水入口保留但任务分配与关闭抵消资金闭环待阶段 5。全套回归通过不替代这些验收。
- task-done：阶段 4 完成；阶段 5、6 未实施。master / 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1–4 未提交，全部未跟踪成果保留，无推送、发布、生产数据操作。

阶段 5 复制文案：

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化阶段 5：实际到账核对联调。

先读 AGENTS.md 和 docs/design/2026-10-10-meal-ticket-workflow-design.md、docs/design/2026-10-10-meal-ticket-workflow-plan.md、docs/design/2026-10-10-meal-ticket-workflow-handoff.md；检查 git 工作区和执行记录，从最早未完成项继续，不跳过、不重做完成工作。

阶段 1–4 已完成。阶段 4 后续页采用登记补扣→逐人办理→核对结果，步骤条只读，无手动下一步、后续充值表或批量设备办理。MealFollowupQueue 消费阶段 2 GET/refresh/progress，按服务端顺序与 current_task_key 恢复，办理仅 pending/skipped；字符串工号保留前导零，复制正数两位金额，复制成功才提示；卡片唯一跳过/完成入口，名单只 select。完成保存成功才换下一项，失败复用请求键并留原任务；awaiting/partial 与 verified 分区，显示已匹配/剩余金额，undo 不写资金，retry 必填确认原因并只办 remaining_cents。清单版本领先/冲突及设置变化阻止旧卡操作，抵消开关仅在更多设置。单人/批量方向表单提交 signed amount；补扣、导入、考勤重算/补入后自动刷新可靠基线下尚未操作清单，批量保存期间不抢写版本。默认显示差额或未完成任务人员，可搜索/显示全部，历史与合法冲正在详情。

本阶段未改 ORM、HTTP、XLS 契约，未接 task_key 支付或自动资金分配；原净额手工实际登记移至详情，数据库核对及取款分类合并为一个入口，普通支付保护保留。阶段 2 followup_state、skip_order、基线、幂等及备份契约不变。旧月 baseline_required 只提示先核对，不能猜测历史方向；阶段 5 必须打通实际流水关联、旧月剩余方向确认和分别办理的合法资金入口。阶段 4 UI/操作声明通过不代表资金闭环完成。

真实验证：frontend 下阶段 4 计划四文件 69 passed；npm test 全套 55 files / 488 passed（10.94s）；npm run build exit 0，仅既有大包提示。项目下阶段 4 计划 tests/test_meal_ticket_followup.py 与 tests/test_backup_coverage.py 共 50 passed（2.49s）；.venv-mac/bin/python -m pytest -q 全套 936 passed（259.50s），包含备份覆盖。git diff --check 通过。已观察卡片、页面、竞态、版本和权限相关失败测试后转绿。

提交状态：master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1–4 全部未提交，所有既有未提交/未跟踪成果保留。无推送、发布或生产数据操作。采用内联自审，无阶段 4 未解决失败；尚未运行真实 MySQL 或浏览器人工验收。

本次授权修改代码，仅完成阶段 5，按 executing-plans 内联执行，不用子代理；不自动推进阶段 6，不推送、不发布、不操作生产数据。联调真实流水分配、手工 task_key 金额校验、部分/延迟到账、同额歧义、冲正、取款与月末清零分类及旧月可靠基线确认。关闭抵消后必须真实分别充值 40、取款 16，保留普通支付净额保护，不能仅显示两个任务却无法记账。已操作但流水延迟不得自动重排或提示再次充值；重办必须显式确认原因且只办剩余金额，核对失败保留原账与进度。保持月度计算/重算/XLS、确认后补扣仅在后续页、服务端持久化进度和唯一入口。

先写有意义的失败测试再实现，运行阶段 5 计划验证及 tests/test_backup_coverage.py；ORM 若变化，同阶段完成备份全链路。更新复选框和执行记录，报告真实结果、限制、提交状态，生成阶段 6 复制文案后停止。未完成或验证失败则继续阶段 5，不声称完成。
```


### 阶段 5 执行记录（2026-10-10，已完成）

- 前置：最早未完成项为阶段 5；工作区 master / 8561b684286f2356de5d233fb373aa637504b3e4，阶段 1–4 全部保留，不提交、不换工作树、不启动子代理。
- Pre-flight：复用阶段 2 任务/资金分配、阶段 4 GET/refresh/progress 和合法实际登记表单；只接资金闭环，不实施阶段 6 验收或发布。
- RED：手工入口 6 个业务测试失败（净额规则拒绝40/16、部分到账未关联、来源保护缺失）；数据库联调 4 个缺失分配/候选/回滚测试失败。额外观察到超额单笔、任务创建前旧流水、未操作来源变化的3个失败，先实现保守匹配后转绿。
- RED（前端）：旧月基线、同额人工关联、真实充值40三个入口缺失；基线旧版本测试验证不能用新读取版本提交旧确认，冲突后重新读取入口缺失测试也已转绿。
- 手工支付可带 task_key/task_version；同人、同方向、当前批次/任务版本、有效来源/设置、方向剩余金额和日期全部验证。同事务写真实支付与分配；普通不带任务支付仍按净待发/待扣回限制。40/16 两顺序最终净已发200；先充值时216，先取款时160。关闭24/24净差额为零仍须两项真实资金办理；操作声明继续不写支付。
- 数据库实际支付只创建一次；核对同事务同步分配/任务。部分10再到账14自动核销；无新流水仍 awaiting，失败保留金额及状态。分配建议先整批计算，多笔/多任务、超额单笔、未操作来源/设置变化时人工关联。清零只写原台账，不核销取款任务；分类沿用唯一核对入口，提交分类即继续核对。跨月范围、旧来源、手工/数据库混用和数据库冲正保护保持。
- 新增 POST /followup-tasks/<task_key>/allocations，管理员、锁/版本及请求幂等保护；只关联真实支付、不新建第二份资金。GET 每项增加 candidates（payment_key/available_cents/date/reference、requires_confirmation）；增加 baseline_items（item_key/工号/姓名/应发分/净已发分/差额分），无本地人员ID写入可移植结果。实际登记入口与操作声明分离，详情有有效任务时不重复提供普通净额入口。
- 旧月确认复用 refresh.baselines，默认只列已证实净差额；两个方向的剩余金额及核实说明由管理员确认。基线确认按页面所见版本提交，冲突后只读重新读取，再核实。
- 审查补强 RED→GREEN：非字符串 task_key/payment_key 在查询前拒绝；手工未先声明直接部分到账10、显式重办14时补齐确认操作证据，修复真实 ZIP 导出阻断，导出/预览均通过。实际冲正保留原分配历史并恢复剩余任务；撤销标记不改资金。
- Ruling：当前 master 原地内联、保留未提交成果并采用自审，不独立派发审查，不删除未提交执行记录。依据用户明确指示；代价：没有独立审查，整体验收仍须阶段 6。
- Ruling：源数据库 naive 时间按 Asia/Shanghai 解释；沿用既有凭证中的完整源时间，UTC资金基线与任务创建时间取较晚者，无法解析不作候选，不新增资金字段。代价：其他时区安装须确认时间约定；任务建立前的迟导历史不得拿来核销新任务，须先核实历史剩余基线。
- Ruling：多笔、多任务、超额单笔及未操作来源/设置变化一律人工确认，避免猜测；代价：减少自动分配覆盖面，需要逐笔核实。
- 内联自审：核对资金/声明分离、普通支付保护、来源与时间、版本/幂等/并发锁、实际回滚、清零/冲正、portable key及备份；无延期 minor，无未解决失败。
- 最终计划后端：`.venv-mac/bin/python -m pytest tests/test_meal_ticket_followup.py tests/test_meal_ticket_reconciliation.py tests/test_meal_tickets.py tests/test_meal_ticket_followup_backup.py tests/test_backup_coverage.py -q` → **160 passed in 22.14s**。
- 最终计划前端：frontend 下 `npm test -- src/pages/MealTicketReconciliation.test.tsx src/pages/MealTicketPaymentCompatibility.test.tsx src/components/MealFollowupQueue.test.tsx` → **3 files / 42 passed in 4.41s**。
- 最终全套：`.venv-mac/bin/python -m pytest -q` → **957 passed in 268.38s**；frontend 下 `npm test` → **55 files / 493 passed in 12.45s**。最新 `npm run build` → **exit 0**，仅既有 >500 kB 大包提示；`git diff --check` → **exit 0**。
- 本阶段没有新增/修改 ORM 字段、关系或意义，没有改变 XLS、备份版本或映射；沿用阶段 2 备份全链路并运行覆盖/资金测试。CardDBClient 的外部读边界使用受控流水替身，真实 Flask/SQLite 写资金、分配和 ZIP/预览；不将其称为真实设备或共享库验收。
- 未运行：真实 MySQL/SQL Server、浏览器人工验收和外部设备联调。保留为阶段 6 限制，不使用生产数据。
- task-done：阶段 5 complete；阶段 6 未开始。master / 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1–5 全部未提交、未跟踪成果保留，无推送/发布/生产数据操作。

阶段 6 复制文案：

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化阶段 6：完整验收与交付。
先读 AGENTS.md 和 docs/design/2026-10-10-meal-ticket-workflow-{design,plan,handoff}.md，检查工作区及执行记录，从最早未完成项继续，不重做阶段 1–5。
阶段 1–5 已完成。阶段 5 已接可选 task_key/task_version 手工支付，同事务校验方向、人员、版本、来源、日期与剩余金额并分配；普通支付净额保护保留。抵消关闭真实充值40/取款16两顺序、净零24/24、部分10+14、冲正、延迟不重排、同额多笔/多任务歧义、清零不核销、失败回滚、幂等与并发均有本地真实路由/资金测试。前端实际登记与操作声明分离，人工关联及旧月剩余方向确认可用，基线冲突可只读重载。
新增管理员 POST /api/meal-tickets/followup-tasks/<task_key>/allocations，提交 batch_id/version/task_version/request_key/payment_key/amount_cents；GET 新增每任务 candidates（支付key、可用分、日期、凭证及 requires_confirmation）与 portable baseline_items。基线确认复用 refresh 的 baselines[item_key]={recharge_cents,refund_cents,reason}。未新增/修改 ORM、XLS或备份版本/映射，阶段 2 备份契约保留。
源数据库 naive 时间按 Asia/Shanghai 转 UTC，原始流水不得早于资金基线和任务创建时间；时间无法解析不作候选。多笔、多任务、超额单笔、未操作来源/设置变化均须人工确认，不猜测。旧月确认先核实全部实际流水，默认只给已证实净差额，分别方向须说明依据。外部数据库已登记资金依旧不得手工重复登记或冲正。
真实验证：阶段 5 计划后端5文件160 passed in 22.14s（含 tests/test_backup_coverage.py）；计划前端3文件42 passed in 4.41s；全套后端957 passed in 268.38s；全套前端55 files/493 passed in 12.45s；最新 npm run build exit 0（仅既有大包提示）；git diff --check通过。无阶段 5 未解决失败；采用内联自审，无独立审查。数据库读边界以受控 CardDBClient 流水替身测试，本地 Flask/SQLite 真实写支付、分配、ZIP导出预览；未跑真实 MySQL/SQL Server、浏览器人工验收或外部设备联调。
提交状态：master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4；阶段 1–5 全部未提交，保留全部既有未提交和未跟踪成果。未推送、未发布、未操作生产数据。
本次仅实施阶段 6，按 executing-plans 内联执行，不用子代理，不推送、不发布、不操作生产数据。完成完整验收、隔离数据/本地预览走两页和两种抵消模式、跳过继续/刷新/并发/部分与延迟、跨ID备份恢复与旧包 absent、旧月接入及用户指南；如有可用隔离数据库按既有入口验证，不能接生产库。先写必要失败测试，再实施；运行完整回归、构建与 test_backup_coverage.py，未运行检查明确报告。保留全部已确认需求，逐项更新记录，生成最终维护交接后停止；未完成则继续阶段 6，不声称整体完成。
```

### 2026-10-10 阶段 6：完整验收与交付 complete

- 接续 handoff“阶段 5 已完成 → 阶段 6”，核对 master / HEAD `8561b684286f2356de5d233fb373aa637504b3e4`。保留阶段1–5全部未提交/未跟踪成果，不重做、不提交、不推送、不发布、不接生产数据。
- 内联执行与自审。沿用用户明确指定的当前工作区；无子代理、无独立审查，不删除未提交执行记录。复核资金与操作分离、剩余义务、两种方向、请求键/版本、源时间、冲正/清零、备份依赖/absent、界面入口。未发现需要改变业务实现的验收缺陷，无延期 minor。
- 阶段6新增：`docs/meal-ticket-workflow-user-guide.md`；`docs/testing/meal_ticket_workflow_acceptance.py`（两个不同管理员的旧版本冲突）；`docs/testing/meal_ticket_workflow_mysql.py`（复用已有 guarded MySQL fixture）；在 `test_meal_ticket_followup_backup.py` 增加双月跨ID真实 ZIP 恢复。仅修正更多设置中仍写“功能启用后应用”的过期说明，无 ORM/HTTP/资金/XLS/备份契约变化。
- 初始完整回归：后端 **957 passed in 256.09s**，前端 **493 passed in 10.66s**，没有基线失败。新增双月测试首次 **1 failed / 19 passed**：合成任务误写未约定的 `initial_cents` 导致导出资金一致性校验拒绝；按已有契约改为 `initial={'recharge':800}` 后通过。这是测试数据构造错误，不是产品缺陷；不将其写成业务 RED→GREEN。

最终实际命令（仓库根目录，前端命令在 `frontend/`）：

| 命令 | 结果 |
| --- | --- |
| `.venv-mac/bin/python -m pytest -q` | **958 passed in 271.55s**，exit 0，包含备份覆盖 |
| `npm test` | **55 files / 493 passed in 13.76s**，exit 0 |
| `npm run build` | exit 0，仅既有 >500 kB 大包提示（AdminMessagesPage 815.60 kB） |
| `.venv-mac/bin/python -m pytest docs/testing/meal_ticket_workflow_acceptance.py tests/test_meal_ticket_followup_backup.py tests/test_backup_coverage.py -q` | **26 passed in 2.09s**，exit 0 |
| `PYTHON_DOTENV_DISABLED=1 PYTHONPATH=.:/private/tmp/mtemphub-stage10-python .venv-mac/bin/python -m pytest docs/testing/meal_ticket_workflow_mysql.py -q` | **16 passed in 10.18s**，exit 0 |
| `git diff --check` | exit 0 |

隔离验收证据：

| 验收项 | 实际结果与边界 |
| --- | --- |
| 月度两页职责 | Chrome + 新建临时 SQLite、真实 Flask 路由与构建产物。九月计算176→重算→确认→下载XLS。xlrd检查2列1行，`['001',176.0]`；下载后净已发仍0。实际手工登记176后结清，唯一原下载入口、按需明细保留。确认后月度页无补扣编辑，后续页无充值表或设备批量入口。 |
| 开启抵消 | 结清176基线后新增+40/-16，任务充值24；浏览器复制工号实读 `001`、金额 `24.00`。跳过并重载仍为 skipped；完成仅声明，净已发仍176。重载仍awaiting，未生成重复待办。 |
| 部分/重办 | 实际手工登记10后partial，净已发186、剩余14。重办表单空原因禁用，填写已核实未到账原因后仅显示充值14；声明后实际登记14，净已发200且任务verified。 |
| 关闭抵消 | 更多设置立即保存且重载保持关闭，异常扣除仍关闭；后续提示设置变化，刷新后历史已到账任务保留。再新增+40/-16生成两项；充值40暂时跳过，当前切到取款16。先声明/登记取款16，净已发200→184，再声明/登记充值40，净已发224、差额0。历史24和本轮40/16合计3项verified。两顺序及净零24/24另经完整路由回归。 |
| 旧页面/双管理员 | 两个浏览器页使用同一合成admin快照，第一页跳过后第二页旧版本完成被409拒绝；没有改写进度。另opt-in真实路由测试创建不同的second-admin，首管理员声明成功、第二管理员旧版本返回409；净已发176且真实支付仅基线1条。不是负载/多机压力测试。 |
| 切月与旧月 | 十月源月份九月，生成160；合成员工乙缺考勤阻止确认，登记本月不发并重算后选择保留，确认成功。进入无基线后续页，先提示核对，不自动历史重发；表单默认001充值160/取款0及002零额，说明必填，核实后生成唯一160任务。返回九月仍3项verified，十月待办未污染九月。 |
| 跨月跨ID备份 | source六月partial24已匹配10、七月awaiting8，真实双月ZIP导出/解码/预览/恢复。目标人员ID99、账套77/78、管理员91，启用SQLite外键；任务portable key、partial/awaiting、资金分配、当前定位及关闭抵消快照保留，实际支付仍1条，foreign_key_check空。目标全局抵消true未被覆盖；恢复只写本地业务记录。 |
| 旧包absent/资金保护 | 旧V1及缺任务/分配、旧meal_batches字段的V2恢复保留目标任务、分配和导航；缺父任务/资金、错误来源、重复或超额分配、冲正状态不一致等预览阻断。单月跨ID与双月恢复均实跑；旧历史已付款调整不重排见完整回归。 |
| 真实隔离MySQL | 复用既有官方8.0.46临时目录和PyMySQL1.1.1，不下载/全局安装；`--no-defaults --skip-networking --mysqlx=OFF`，仅`/private/tmp/mtemphub-stage10-mysql/server.sock`。fixture先验证datadir，再每项随机schema。真实新表外键拒绝悬空支付并回滚、旧结构升级两次、资金依赖/状态、旧V1/V2均通过。最终确认关闭网络且无残留测试schema，已关闭该实例。不是生产迁移链验证。 |

- 隔离浏览器会话：`http://127.0.0.1:5099`，仅合成人员001/002，临时脚本 `/private/tmp/meal-workflow-stage6-server.py` 使用测试fixture，新建 `/var/folders/.../test.db`，未读项目 `.env`；预置测试Cookie不代表登录/验证码已验收。临时脚本不写入产品、不部署。初次监听被沙箱拒绝，授权后仅绑定127.0.0.1；测试Cookie与CSRF白名单在临时注册时校准，不修改产品认证。
- 完整日志 `/private/tmp/meal-workflow-stage6-{backend,backend-final,frontend,frontend-final,build,build-final,backup,acceptance,mysql,mysql-final,server}.log`；浏览器结清截图 `/private/tmp/meal-workflow-stage6-browser-verified.png`。截图与日志是临时佐证，长期维护以本记录、验收脚本和指南为准。
- 未运行：真实外部菜票SQL Server/共享流水库、真实充值取款设备、生产升级/恢复/部署、真人登录与验证码、移动设备、多机压力与故障注入。数据库核对的延迟、同额歧义、源时间、跨月范围、分类/清零、失败回滚由受控CardDBClient边界+真实本地路由/资金回归验证，不能描述成浏览器连真实设备已通过。
- task-done：阶段6隔离软件验收与交付完成；阶段1–6全部未提交，HEAD未变。最终维护复制文案见handoff最后一节，无虚构阶段7。

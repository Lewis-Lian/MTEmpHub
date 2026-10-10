# 菜票中心改造：新对话复制文案

用法：首次复制“阶段 1”。每阶段完成后，助手须在最终回复提供已填入实际结果的下一阶段文案；可直接复制它开启新对话。
下面的静态文案也可独立使用：新助手必须读取计划执行记录判断真实进度，不能假定上一阶段已成功。
如果当前阶段未完成，下一对话继续当前阶段，不跳到后续阶段。
不必把全部六段一次发给助手；一次只发一个阶段。


## 阶段 1：设置与金额契约

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 1：设置与金额契约。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：在项目现有 /admin/more-settings 页面增加默认开启的“补发与扣款抵消”开关，独立保存不影响异常扣除开关；确定后续任务金额/接口契约并完成纯金额投影测试。不要提前改月度或后续补扣页。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。完成后给我可以直接复制到新对话的阶段 2 启动文案，包含本阶段真实结果、接口/模型变化、未解决事项、当前代码提交状态和下一阶段范围。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 阶段 2：持久化任务、进度与备份

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 2：持久化任务、进度与备份。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：实现后续任务、操作进度及真实流水分配后端，设置切换只刷新未操作任务。已操作不等于到账，历史补扣不能重新全部入队。新增 ORM 数据同步完成备份注册、导出、预览、恢复、依赖、旧包 absent 兼容及整库迁移，不能留给后面补。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。完成后给我可以直接复制到新对话的阶段 3 启动文案，包含本阶段真实结果、接口/模型变化、未解决事项、当前代码提交状态和下一阶段范围。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 阶段 3：月度发放页四阶段简化

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 3：月度发放页四阶段简化。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：将月度发放改为选月份→计算与核对→导出并充值→核对到账。保留计算、重算草稿、确认核算及月度两列 XLS。每个操作一个入口，步骤条无按钮；确认后的补扣仍只能在后续补扣页。此阶段不改后续页布局。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。完成后给我可以直接复制到新对话的阶段 4 启动文案，包含本阶段真实结果、接口/模型变化、未解决事项、当前代码提交状态和下一阶段范围。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 阶段 4：后续补扣页逐人操作

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 4：后续补扣页逐人操作。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：实现登记补扣→逐人办理→核对结果。按工号提供复制工号、复制正数两位金额、跳过、已完成充值/取款下一人，固定清单顺序并恢复进度。后续页不导出充值表、不批量充值取款；批量登记补扣/表格导入仍保留。接入服务端任务，不用 localStorage 代替业务状态。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。完成后给我可以直接复制到新对话的阶段 5 启动文案，包含本阶段真实结果、接口/模型变化、未解决事项、当前代码提交状态和下一阶段范围。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 阶段 5：实际到账核对联调

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 5：实际到账核对联调。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：打通真实流水与任务分配、手工登记的任务金额校验、部分到账、同额歧义、冲正、取款/清零分类。关闭抵消必须能分别充值40和取款16，不能只展示两个按钮却被净额支付规则阻止；普通月度支付原保护保留。已操作但流水延迟不能自动重复提示办理。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。完成后给我可以直接复制到新对话的阶段 6 启动文案，包含本阶段真实结果、接口/模型变化、未解决事项、当前代码提交状态和下一阶段范围。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 阶段 6：完整验收与交付

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
请实施菜票中心流程简化的阶段 6：完整验收与交付。

先阅读项目 AGENTS.md 和以下文档：
- docs/design/2026-10-10-meal-ticket-workflow-design.md
- docs/design/2026-10-10-meal-ticket-workflow-plan.md
- docs/design/2026-10-10-meal-ticket-workflow-handoff.md

先检查 git 工作区和计划执行记录。如果前置阶段未完成，先说明并补完最早未完成阶段，不跳过、不重做已完成工作。
本次授权修改代码，只完成本阶段，按 executing-plans 内联执行，不需要子代理；不要自动推进后续阶段，不推送、不发布，不操作生产数据。

本阶段重点：运行完整后端测试、完整前端测试及构建，实际验证两页流程、两种抵消模式、工号前导零、跳过继续、部分/延迟到账、旧数据、备份跨库ID恢复与旧包 absent。完成使用指南、更新进度，未运行的验证明确说明，给出最终交接文案。

保留用户确认的全部需求：月度计算/重算/导出；确认后补扣只在后续页；充值和取款按工号逐人办理；同人抵消默认开启，开关仅在项目更多设置页面；操作进度与实际到账分离；每个操作只一个入口。
按计划先写有意义的失败测试再实现，运行本阶段相关验证及 tests/test_backup_coverage.py。修改业务 ORM 的表/字段/关系/意义时，同阶段完成备份全链路和旧格式兼容。
完成后更新计划复选框和执行记录，报告真实测试结果和限制，然后停止。全部完成后给出最终交接文案，用于以后继续维护。
如验证失败或阶段未完成，提供继续本阶段的复制文案，不声称完成。
```


## 每阶段完成后必须生成的交接内容

助手结合实际执行结果生成可复制文案，内容至少包括：

1. 项目路径、设计/计划/交接文档路径。
2. 已完成阶段、当前阶段实际实现结果及验证命令/结果。
3. 已固定的接口/模型字段、需要下一阶段消费的契约。
4. 未解决事项、未运行检查、当前分支与提交/未提交状态。
5. 下一阶段编号、范围、停止条件；禁止跳过未通过前置阶段。
6. 下一阶段完成后继续生成交接文案的要求。

静态启动文案中未写任何测试通过或提交事实；这些必须由实施助手在执行后填入，不能预先编造。

阶段 6 完成后的文案用于以后维护，列出完成状态、文档、实际限制与检查依据，不再虚构阶段 7。


## 2026-10-10 实际交接：阶段 1 已完成 → 阶段 2

以下文案包含阶段 1 真实结果；静态阶段文案不能替代计划执行记录。

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


## 2026-10-10 实际交接：阶段 2 已完成 → 阶段 3

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


## 2026-10-10 实际交接：阶段 3 已完成 → 阶段 4

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


## 2026-10-10 实际交接：阶段 4 已完成 → 阶段 5

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


## 2026-10-10 实际交接：阶段 5 已完成 → 阶段 6

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

## 2026-10-10 最终实际交接：阶段 1–6 已完成（维护用）

```text
项目：/Users/lewis/Lewis/code/git/MTEmpHub。
菜票中心流程简化阶段1–6已完成隔离软件验收与文档交付。以后按维护需求接续，不重做已完成阶段，不虚构阶段7。
先读AGENTS.md、docs/design/2026-10-10-meal-ticket-workflow-{design,plan,handoff}.md及docs/meal-ticket-workflow-user-guide.md，核对工作区和计划最后的阶段6执行记录。

master，HEAD 8561b684286f2356de5d233fb373aa637504b3e4。阶段1–6全部未提交，既有改动/未跟踪成果保留。没有提交、推送、发布、生产数据操作。executing-plans内联，无子代理；作者自审，无独立审查。无未解决测试失败或延期minor。

最终实跑：
- 仓库根目录 .venv-mac/bin/python -m pytest -q →958 passed in 271.55s，含备份覆盖。
- frontend下 npm test →55 files/493 passed in 13.76s；npm run build exit0，仅既有AdminMessagesPage815.60kB/大包提示。
- .venv-mac/bin/python -m pytest docs/testing/meal_ticket_workflow_acceptance.py tests/test_meal_ticket_followup_backup.py tests/test_backup_coverage.py -q →26 passed in 2.09s。
- PYTHON_DOTENV_DISABLED=1 PYTHONPATH=.:/private/tmp/mtemphub-stage10-python .venv-mac/bin/python -m pytest docs/testing/meal_ticket_workflow_mysql.py -q →16 passed in 10.18s。
- git diff --check通过。

Chrome+新建临时SQLite真实走九月计算176、重算、确认、两列XLS下载、手工到账结清；XLS实读['001',176.0]，下载不入账，结清保留资料/原下载入口。开启抵消+40/-16→24，复制001/24.00、跳过重载、声明不入账、10部分到账+仅重办剩余14均可用。关闭抵消再+40/-16，先取16再充40，净已发200→184→224，两项完成；历史24及本轮40/16合计三项verified。
第二浏览器页面旧版本被409拒绝。独立路由测试两个不同管理员的旧快照同样被拒绝且不写第二笔资金。十月无基线先提示核对，默认仅160净差额、原因必填，确认后生成唯一剩余任务；返回九月仍三项verified。两顺序、净零24/24、迟到流水、失败回滚及清零分类另由完整路由/组件回归验证。

双月真实ZIP恢复到不同ID、启用FK目标库：人员99、账套77/78、管理员91；六月partial24已到账10、七月awaiting8保留，portable key、分配、定位、关闭抵消历史快照不变，实际支付仍1条，FK检查空，目标全局抵消true未被覆盖。旧V1/V2缺新数据集为absent，不删除目标任务/分配/导航；资金依赖及状态阻断实跑。恢复只写本地记录，不调用设备、不变成待重办。
真实MySQL复用已有官方8.0.46临时实例，只用/private/tmp/mtemphub-stage10-mysql/server.sock、禁用网络，fixture先校验datadir再为每项创建随机schema。新增外键拒绝悬空支付/事务回滚、旧结构重复升级、资金依赖与旧包兼容通过；收尾确认无残留测试schema并关闭实例。复跑配置见docs/testing/monthly-backup-verification.md，不得换成生产连接。

阶段6仅新增用户指南、两份docs/testing验收脚本、双月跨ID测试并修正更多设置的过期说明。没有改变ORM/HTTP/资金/XLS/备份契约。
既有契约：月度计算/重算/确认和XLS保留，下载不算到账，确认后应发调整只在后续页；抵消默认开启、安装级、仅在更多设置修改。MealTicketFollowupTask、MealTicketFollowupAllocation和batch.followup_state保存任务、资金分配、基线与定位，操作声明不写资金。GET只读，refresh/progress/allocations保留版本、摘要、幂等请求和portable key。手工实际支付可带task_key/task_version按方向剩余校验，普通支付净额保护不放宽。
源流水naive时间按Asia/Shanghai，早于UTC基线或任务创建不自动核销；同额多笔/多任务/超额及未操作来源或设置变化须人工确认。旧月先核实全部实际流水，再确认剩余方向基线，不重发全量历史调整。安装开关不随月度备份覆盖，清单采用历史抵消快照。

未运行：真实外部SQL Server/共享菜票流水库、真实设备充值取款、生产升级/恢复/部署、真人登录验证码、移动设备、多机压力及故障注入。外部核对延迟/歧义/源时间/分类清零/失败回滚使用受控CardDBClient边界及真实本地资金路由测试；不能把隔离SQLite/MySQL或浏览器手工模式称为设备联调通过。临时浏览器仅预置合成会话，已关闭服务，不用于产品。

长期依据为计划阶段6验收矩阵、用户指南和两份docs/testing验收脚本；临时日志/private/tmp/meal-workflow-stage6-*.log和截图/private/tmp/meal-workflow-stage6-browser-verified.png仅作当次佐证。后续修改ORM或字段含义时仍同步备份完整链路/旧包absent并运行test_backup_coverage.py。
未来提交、推送、发布及任何生产操作需新的明确任务授权；本次停止在交付完成状态。
```

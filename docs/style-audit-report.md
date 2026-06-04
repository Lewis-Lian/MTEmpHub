# 前端样式全量审查报告

审查日期：2026-06-04

## 审查范围

- 前端入口与路由：`frontend/src/main.tsx`、`frontend/src/router/index.tsx`、`frontend/src/layouts/AppShell.tsx`
- 全局样式：`frontend/src/styles/legacy-ui.css`
- 页面样式：`frontend/src/pages/query/QueryHome.css`、`frontend/src/pages/query/EmployeeDashboardPage.css`
- 代表页面实测：登录页、首页、员工考勤数据查询、账套管理、账号管理、员工管理

## 验证方式

1. 执行 `npm run build`，确认前端构建通过。
2. 启动 Flask 后端与 Vite 前端，使用默认管理员 `admin/admin123` 登录。
3. 在 1280x720、768x720、375x667 三个视口下采样页面横向溢出、被裁切元素、滚动尺寸。

构建结果：通过。打包 CSS 约 125.53KB。

## 总体结论

当前样式问题不是单个页面的小瑕疵，而是样式治理已经失控：全局 CSS 过大、选择器过宽、页面级 CSS 反向覆盖全局样式、`!important` 和 `z-index` 被大量用于补丁式修复。登录页表现相对稳定，但登录后的后台页面在窄屏和数据表格页面上存在明显横向溢出、内容裁切、内部滚动嵌套过深等问题。

## 关键数据

| 文件 | 行数 | `!important` 数量 | `z-index` 数量 | `overflow: hidden` 数量 |
| --- | ---: | ---: | ---: | ---: |
| `frontend/src/styles/legacy-ui.css` | 6338 | 962 | 50 | 24 |
| `frontend/src/pages/query/QueryHome.css` | 677 | 0 | 3 | 6 |
| `frontend/src/pages/query/EmployeeDashboardPage.css` | 461 | 162 | 5 | 3 |

## 主要问题

### P0：查询页样式选择器过宽，影响多个页面

`EmployeeDashboardPage.css` 直接定义 `.query-page-shell`、`.query-filter-rail`、`.employee-picker-modal` 等通用类，并且大量使用 `!important`。这些类不只属于员工查询页，还被异常查询、管理人员查询、修正中心等页面复用。

证据：

- `frontend/src/pages/query/EmployeeDashboardPage.css:6` 重写 `.query-page-shell`，设置固定视口高度与 `overflow: hidden !important`。
- `frontend/src/pages/query/EmployeeDashboardPage.css:24`、`85` 重写 `.query-filter-rail`。
- `frontend/src/pages/query/EmployeeDashboardPage.css:34` 将 `.employee-picker-modal` 提升到 `z-index: 9999 !important`。
- `frontend/src/styles/legacy-ui.css:1025` 已经定义过 `.query-page-shell`，页面 CSS 再次覆盖。

影响：

- 任意使用 `.query-page-shell` 的页面都会继承员工查询页视觉和布局策略。
- 页面之间的样式结果依赖 CSS 加载顺序，而不是组件边界。
- 后续改一个查询页，可能误伤多个管理页。

建议：

- 将员工查询页样式收敛到页面命名空间，例如 `.employee-dashboard-page .query-page-shell`。
- 把通用查询布局和页面专属视觉分开。
- 移除页面 CSS 对 `.employee-picker-modal` 这类全局弹窗的直接覆盖。

### P0：后台框架移动端没有真正响应式布局

后台主框架仍以桌面管理系统为默认假设，移动端只是隐藏/压缩部分区域，但内容区里的表格、页签和操作栏仍按桌面宽度布局。

实测：

- 375x667 下，`/employee/dashboard` 的表格固定 640px 宽，左侧 57px，右侧 697px，远超 375px 视口。
- 375x667 下，`/admin/accounts` 的账号表格宽 1469px，内部横向滚动明显。
- 375x667 下，`/admin/employees/manage` 的员工表格宽 1320px，内部横向滚动明显。

证据：

- `frontend/src/styles/legacy-ui.css:2819` `.legacy-table` 默认 `min-width: 640px`。
- `frontend/src/styles/legacy-ui.css:2157` 账号表格面板使用固定高度计算。
- `frontend/src/styles/legacy-ui.css:4021` 附近主数据表格面板继续沿用桌面表格模式。
- `frontend/src/styles/legacy-ui.css:3197`、`3229` 虽然有移动端媒体查询，但没有为大表格提供卡片化或列优先级方案。

建议：

- 后台可明确声明“移动端只支持横向滚动表格”，但需要让滚动容器可见、稳定、可操作。
- 如果要支持手机，应为表格页建立移动端卡片列表或列优先级折叠方案。
- 表格最小宽度应由列配置决定，不应所有表格默认 640px。

### P1：首页容器使用 `overflow: hidden`，长页面内容有裁切风险

首页 `.query-home-container` 设置 `overflow: hidden`。实测首页内容高度远大于视口高度：

- 1280x720 下，容器高度约 1254px，页面滚动高度 1346px。
- 375x667 下，容器高度约 2351px，页面滚动高度 2443px。

这类长内容容器不应使用 `overflow: hidden`，否则背景装饰、动效、内部元素或弹层容易被裁切。

证据：

- `frontend/src/pages/query/QueryHome.css:42` 定义 `.query-home-container`。
- `frontend/src/pages/query/QueryHome.css:53` 设置 `overflow: hidden`。

建议：

- 改为只隐藏装饰层本身的溢出，不要隐藏整个内容容器。
- 背景光球单独包一层绝对定位装饰容器，并限制该装饰层 `overflow`。

### P1：层级管理混乱，存在弹层互相压制风险

当前多处用高 `z-index` 修补下拉、弹窗、表头、进度条遮挡问题。

证据：

- `frontend/src/styles/legacy-ui.css` 中 `z-index` 出现 50 次。
- `frontend/src/styles/legacy-ui.css:1114` `.employee-float-list` 使用 `z-index: 1200`。
- `frontend/src/styles/legacy-ui.css:2077`、`2081`、`2099`、`2115`、`2120` 多个页面分别给员工选择下拉设置不同层级。
- `frontend/src/styles/legacy-ui.css:5169` `.employee-picker-modal` 被强制到 `z-index: 99999 !important`。
- `frontend/src/pages/query/EmployeeDashboardPage.css:35` 又对同一弹窗设置 `z-index: 9999 !important`。

影响：

- 弹窗、下拉、表头、进度条的层级关系不可预测。
- 新增弹层时容易继续堆更大的 `z-index`。

建议：

- 建立层级 token，例如 `--z-dropdown`、`--z-sticky`、`--z-modal`、`--z-toast`。
- 弹窗统一走 portal 到 `document.body`，避免受父级 `overflow` 和 stacking context 影响。
- 页面局部不要直接覆盖全局弹层层级。

### P1：`!important` 密度过高，说明覆盖链已经失控

全局样式中有 962 个 `!important`，员工查询页 CSS 中还有 162 个。这会让后续修复很难做到局部、可预测。

典型位置：

- `frontend/src/pages/query/EmployeeDashboardPage.css:86` 到 `405` 几乎整段都在用 `!important` 覆盖通用查询样式。
- `frontend/src/styles/legacy-ui.css:5028` 之后多次重复覆盖 `.app-tab-bar`、`.app-tab-list`、`.app-tab-button`。
- `frontend/src/styles/legacy-ui.css:5166` 之后再次覆盖全局弹窗、页签、分页器。

建议：

- 先不要全量重写样式。优先把页面级覆盖收进命名空间。
- 每次修复一个页面时，同步删除同区域的重复 `!important`。
- 新增样式禁止直接写通用类名加 `!important`。

### P1：固定高度和隐藏溢出导致内容区域被截断

实测发现多个面板在视口底部被截断，依赖内部滚动继续操作。

实测：

- 1280x720 下，`/admin/accounts` 的 `.query-result-panel` 底部到 744px，超过 720px 视口；父级 `overflow: hidden`。
- 1280x720 下，`/admin/employees/manage` 的 `.query-result-panel` 底部到 875px，超过 720px 视口。
- 375x667 下，`/employee/dashboard` 的 `.query-workspace` 高度只有约 26px，内部还包含进度条和表格文本。

证据：

- `frontend/src/pages/query/EmployeeDashboardPage.css:13`、`14` 固定 `height: calc(100vh - 86px)`。
- `frontend/src/pages/query/EmployeeDashboardPage.css:15` 设置 `overflow: hidden !important`。
- `frontend/src/pages/query/EmployeeDashboardPage.css:360` 到 `388` 再次把查询结果区改成 `height: 100%`、`overflow: hidden` 与内部滚动。

建议：

- 页面根容器避免固定高度加隐藏溢出；优先使用 `min-height`。
- 只有表格滚动区域负责滚动，外层不要层层隐藏。
- 对移动端查询页单独定义过滤区与结果区的堆叠高度。

### P2：同一组件样式被多处重复覆盖

页签栏、分页器、按钮、员工选择器都在全局 CSS 后半段被反复覆盖。注释中也能看到多次“修复、升级、重塑”的痕迹。

证据：

- `.app-tab-bar` 至少在 `frontend/src/styles/legacy-ui.css:827`、`4347`、`5028`、`5192` 多次定义。
- `.table-pager` 先在 `frontend/src/styles/legacy-ui.css:2848` 附近定义，又在 `5266` 后强制缩小。
- `.employee-picker-modal` 在 `frontend/src/styles/legacy-ui.css:1167`、`5169` 和页面 CSS 中都有定义。

影响：

- 修改组件样式时不知道哪个定义最终生效。
- 后续维护者容易继续追加覆盖，而不是清理源头。

建议：

- 先为 `AppTabs`、`QueryTable`、`EmployeePicker`、`MonthPicker` 建立各自稳定 CSS 区块。
- 保留最后生效的一份样式，删除同一组件的旧覆盖。

### P2：部分视觉策略与项目后台工具属性不匹配

项目是考勤/管理后台，但部分页面使用大量玻璃拟态、发光球、动效、渐变阴影。视觉负担较重，也增加了重叠和裁切风险。

证据：

- `frontend/src/pages/query/QueryHome.css:58` 起使用多个背景光球。
- `frontend/src/pages/query/EmployeeDashboardPage.css:38` 起复用同类背景光球。
- `frontend/src/styles/legacy-ui.css:5600` 后继续加入大量拟物化上传、按钮、设置面板样式。

建议：

- 管理后台应优先清晰、稳定、密集可扫读。
- 装饰层应限制在首页或欢迎面板，不应进入通用查询页。

## 已确认表现正常的部分

- 登录页在 1280x720、1024x720、768x720、375x667 下没有检测到横向溢出。
- 前端构建通过，当前问题不是编译失败或 CSS 语法错误。

## 建议修复顺序

1. 收敛 `EmployeeDashboardPage.css`：给页面根元素加专属类，所有规则纳入页面命名空间，停止覆盖通用 `.query-page-shell`。
2. 清理 `.query-page-shell` 高度策略：移除固定 `height/max-height + overflow hidden`，改为外层自然滚动、表格区域内部滚动。
3. 建立统一层级 token：替换散落的 `z-index: 1200/4200/9999/99999`。
4. 重整表格响应式：桌面保留横向滚动，手机端明确使用卡片化或可见滚动提示。
5. 拆分 `legacy-ui.css`：先按组件拆分页签、表格、弹窗、查询过滤、管理表单，不做视觉大改。
6. 渐进删除重复覆盖和 `!important`：每修一个区域删除一个区域，不建议一次性全量重写。

## 风险提示

本次报告没有修改业务样式，仅做审查。由于样式文件中存在大量顺序依赖和 `!important`，后续修复应小步提交，每次只处理一个组件或一类页面，并用 1280、768、375 三个宽度做回归截图或自动化布局检查。

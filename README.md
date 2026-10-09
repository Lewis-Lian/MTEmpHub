# MTEmpHub 员工综合服务平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

MTEmpHub 是以**月度账套**为中心的员工考勤与管理人员统计平台。系统将 Excel 原始报表、考勤机数据库或钉钉记录汇入统一的数据模型，提供考勤查询、异常核对、人工修正、加班与年休统计、部门工时和报表导出。

前端为 React + TypeScript + Vite，后端为 Flask JSON API；默认使用 SQLite，也支持 MySQL。Windows 可通过 Waitress + NSSM 运行后端服务，Linux 可通过 Gunicorn + Systemd + Nginx 部署。

## 目录

- [功能概览](#功能概览)
- [架构与项目结构](#架构与项目结构)
- [本地开发](#本地开发)
- [配置说明](#配置说明)
- [月度账套与导入流程](#月度账套与导入流程)
- [考勤来源与统计口径](#考勤来源与统计口径)
- [账号与权限](#账号与权限)
- [账套备份与恢复](#账套备份与恢复)
- [数据库初始化与迁移](#数据库初始化与迁移)
- [生产部署与运维](#生产部署与运维)
- [开发验证与常见问题](#开发验证与常见问题)
- [开源协议](#开源协议)

## 功能概览

| 模块 | 已实现能力 |
| --- | --- |
| 查询中心 | 个人考勤日历、月度考勤数据、异常记录、原始打卡、请假明细、部门工时、Excel 导出；独立菜票查询 |
| 管理人员查询 | 月度考勤、部门工时、年度加班与年休统计、管理人员考勤模板导出 |
| 账套中心 | 按月创建与激活账套、厂休明细与福利天数设置、原始文件归档、分员工/管理人员重新计算、进度展示、锁定与解锁 |
| 菜票中心 | 实际打卡字段 × 8 元、次月核算充值、额外补扣、确认冻结、实际充值/扣回/冲正、历史原账导入与试算对账；部门发放汇总、外来领用、全年汇总及月末取款台账 |
| 下载中心 | 原有考勤汇总下载；充值记录、部门发放汇总、外来领用、全年汇总、月末取款五类 Excel 存档 |
| 基础资料 | 员工、部门层级、班次和员工班次分配；员工与部门 Excel 模板、导入导出；离职与复职处理 |
| 考勤修正 | 员工与管理人员月度修正、每日考勤日历修正、批量操作、实际打卡标记、修正历史 |
| 请假与迟到 | 请假单修改、撤销与恢复；迟到抵扣候选、确认与清除 |
| 外部同步 | 员工考勤机 SQL Server 同步、管理人员钉钉同步、连接测试、同步进度与历史、未匹配记录 CSV |
| 账号管理 | 管理员与查询账号、页面权限、员工与部门数据授权、停用账号解锁、改密与头像 |
| 消息中心 | 管理员发送富文本消息、按人员范围或指定账号发送、收件人消息详情与已读状态 |
| 数据维护 | 月度账套 ZIP 导出与差异预览恢复、SQLite/MySQL 连接设置与迁移向导 |

## 架构与项目结构

菜票中心按**计划充值月份**选择数据，例如 9 月充值读取 8 月考勤。“月度发放”按生成草稿、补发/扣除、确认核算、导出充值表、登记实际充值、核对结清的顺序完成；确认前需锁定对应考勤账套，确认后才可导出充值表。实际充值成功后再登记发放。“后续补扣与对账”处理已核算月份的追加补扣、实际补发或扣回，并再次核对结清。已确认的基础金额保持快照，调整必须填写原因。结清按整月全部人员的应发与净已发金额逐人检查，不受列表筛选或差额抵消影响，目前以实际发放登记为依据。

已确认月份的考勤更正，在“后续补扣与对账”第一步点击“重算考勤数据”，预览逐人差额后确认登记考勤补扣，再完成实际补发或扣回并核对结清。重算保留原基础金额、手工补扣、实际充值流水和本月不发选择；相同考勤重复重算不会重复补扣。新增人员在预览的“新增人员核对”中查看考勤、核对部门和金额，填写原因后点击“核对并补入本月核算”；缺考勤或字段异常须先修正再重新预览。补入按当前考勤生成应发金额，保留操作人、时间和原因，不修改原人员账目，也不自动登记充值。补入后可继续额外补扣、导出充值表和实际发放；刷新预览后继续确认其他人员的考勤差额。人员移出范围仍须人工核对。完成补入或后续重算的月份不能再退回月度草稿；已确认的月度发放页不再提示源考勤变化。

“导出充值表”生成 `.xls` 文件，第一行直接为数据，仅含员工编号（卡号）和充值金额两列，无表头、无自定义单元格格式或列宽。金额为应发减净已发的正数余额；保留编号前导零，不受页面列表筛选影响，查询账号仅导出授权人员。导出不会登记实际充值，全部结清时文件为空表。

尚未登记任何充值、扣回或冲正流水时，管理员可在“导出充值表”步骤点击“退回上一步”，取消核算确认并恢复草稿编辑；原明细、补扣及本月不发选择保留，考勤账套不会自动解锁。退回后须重新确认、重新导出，旧充值表不再使用。已有发放流水时禁止退回，即使净已发因冲正归零，也只能通过补扣或冲正处理；在外部充值系统已经完成的充值须先登记实际流水。

离职登记日期有延迟时，按人员实际情况决定是否结算。草稿中可选择“本月不发”并填写原因：本月基础金额和已有补扣按 0 元核算，原始依据和处理历史保留，考勤异常不再阻止确认；重算保留该选择。“恢复核算”恢复原考勤与补扣金额，仍需处理考勤异常。已确认后须先退回草稿才能更改此选择；已有发放流水时，若需补发，新增补扣记录，再登记实际充值。

历史充值 xlsx 上传后须核对文件月份含义、人员映射、部门名称、公式缺缓存和年月差异，再确认导入。部门可下拉选择现有部门，也可填写仅用于历史原账的部门名称，不新增系统部门或修改员工当前部门。预览支持一键筛选全部问题行、跨页多选及批量设置部门、填写更正说明、跳过或恢复；筛选不影响确认时提交完整原账。原账与当前字段试算分别展示，导入不生成实际充值。

新增“菜票查询”独立于两类考勤查询，只读展示核算、补扣、到账差额与清零记录。“下载中心”承接原考勤汇总下载，旧 `/employee/summary-download` 地址保持跳转兼容。菜票存档导出实际数值，充值表不重复附加右侧部门透视汇总；草稿及导出时间明确标识。原两列 `.xls` 专用充值文件仍在月度发放流程中使用。

外来领用、全年汇总及取款台账由管理员维护，部门发放汇总自动生成。查询账号须开通“菜票台账与存档下载”权限才能查看公司部门发放汇总、外来领用、全年汇总和取款记录。仅“菜票查询”权限的账号仍按授权人员/部门范围查询和下载充值及部门报表，不包含客人领用金额。客人卡充值或纸质菜票实际发放后，在“外来人员领用”选择实际业务月份和“充卡 / 纸质”，填写处理日期、姓名或单位、承担费用的部门、实际金额及卡号等信息；纸质金额为票面总额。有效记录自动计入对应月份部门统计，无需在部门页重复登记。部门发放合计为员工净实际发放＋客人卡充值＋客人纸质菜票，作废记录不计入；没有员工核算的部门也可显示客人金额。“部门菜票发放汇总”只用于查看和存档，无手工保存或历史表格导入入口；部门存档保留历史登记信息及原表布局，并附分类金额明细页。年度充值包含人员实际充值与外来充卡，纸质单列；二楼、三楼消费先按月录入，缺失月份保留“未录入”。

月末余额清零在原菜票软件办理，本项目保存已完成的取款记录，卡余额即清零金额。清零不影响人员发放结清。数据库对账遇到新的取款流水时，需逐笔分类为“菜票扣回”或“月末清零”；待分类流水不参与结清，既有历史结果不自动改账。同一来源不得同时用于扣回与清零。

各业务台账页面不再显示历史表格导入及导入历史入口，历史数据通过已有历史台账功能维护。后台仍支持历史 `.xlsx` 上传、预览、逐行确认年月/处理日期和部门名称，再确认入账；右侧透视表和合计行不导入。同来源重复导入拦截，疑似重复须明确接受或跳过。历史部门、年度原额保留作对照，不叠加正式实际金额。错误记录作废并保留历史。独立台账按业务月纳入月度备份，来源文件随关联记录备份；整库切换也包含新台账。

部署前执行既有 `python -m flask --app manage.py db upgrade` 流程升级至 `20261008_ledgers`，创建两张独立台账表并扩展对账结果字段。SQLite 增量迁移已通过自动化验证；MySQL 使用行锁与唯一约束处理写入，部署到 MySQL 前仍需在目标环境验证。

```text
浏览器 → React 前端 → /api/* → Flask 路由 → 业务服务 → SQLAlchemy → SQLite / MySQL
                                          ↑
                          Excel / 考勤机 SQL Server / 钉钉
```

开发时 Vite 将 `/api` 代理到后端；生产时由 Web 服务器提供 `frontend/dist`，并代理 API。Flask 的业务页面由独立前端承载，健康检查为后端的 `GET /health`。

```text
MTEmpHub/
├── app.py                     # 应用工厂、日志配置、健康检查、开发入口
├── wsgi.py                    # Waitress / Gunicorn 入口
├── manage.py                  # 数据库初始化、管理员初始化、旧库兼容升级 CLI
├── config.py                  # 数据库、认证、来源白名单、运行目录配置
├── models/                    # 员工、账号、账套、考勤、修正、消息等数据模型
├── routes/                    # 认证、查询、后台、导入、备份与消息接口
├── services/                  # 导入、统计、同步、修正、迁移、备份恢复及进度服务
├── utils/                     # Excel 解析、环境配置、导航及通用工具
├── migrations/                # Flask-Migrate / Alembic 迁移历史
├── frontend/                  # React + TypeScript 前端
│   ├── src/api/               # API 客户端与类型化请求
│   ├── src/pages/             # 查询页面、后台页面、登录及数据库向导
│   ├── src/components/        # 考勤日历、选择器、导入与备份弹窗等
│   └── src/router/            # 页面路由与登录保护
├── templates/export_templates/ # 管理人员考勤 Excel 导出模板
├── tests/                     # 后端回归测试
├── scripts/                   # Windows / Ubuntu 部署、迁移及专项诊断脚本
├── macrun2.sh                 # Mac / Linux 前后端开发启动
├── winrun.sh                  # Git Bash 下 Waitress + Vite preview 启动
├── deploy_production.ps1      # Windows 后端部署入口
├── update.sh                  # 固定 Ubuntu 部署环境更新
└── restart.sh                 # Ubuntu 服务重启
```

运行后还会生成 `instance/`、`static/uploads/` 和 `logs/`。默认 SQLite 文件为 `instance/attendance.db`；原始文件位于 `static/uploads/account_sets/<YYYY-MM>/`。这些运行数据不应作为代码提交。

## 本地开发

### 1. 准备环境

- Python 3.12，使用虚拟环境安装后端依赖。
- Node.js 22.13+（22 系列）或 24+，以及 npm。当前锁定依赖也支持 Node 20.19+；Node 18 不满足当前前端依赖要求。
- 默认 SQLite 无需独立安装数据库服务；使用 MySQL 或 SQL Server 同步时需准备对应数据库及网络连接。
- LibreOffice 为可选依赖，用于部分旧 `.xls` 或特殊管理人员报表的转换兜底。

在项目根目录执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Windows PowerShell 的虚拟环境创建与激活方式：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

### 2. 配置密钥与初始管理员

编辑 `.env`，替换 `SECRET_KEY` 占位符，并增加 `INITIAL_ADMIN_PASSWORD`：

```dotenv
DATABASE_URL=sqlite:///attendance.db
SECRET_KEY=填入随机生成的密钥
INITIAL_ADMIN_PASSWORD=填入初始管理员密码
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

可用以下命令生成密钥，再复制到 `.env`：

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

`.env.example` 中的默认密钥会被启动校验拒绝。系统没有内置默认管理员密码；创建新管理员必须显式配置密码。

### 3. 初始化数据库与管理员

```bash
python -m flask --app manage.py init-db
python -m flask --app manage.py init-admin
```

管理员用户名为 `admin`。`init-admin` 仅在该账号不存在时创建，不会重置已有密码。应用启动不会自动建表或创建管理员。

### 4. 启动前后端

后端终端（根目录，激活虚拟环境）：

```bash
python app.py
```

前端终端：

```bash
cd frontend
npm ci
npm run dev
```

打开 <http://localhost:5173>，使用 `admin` 和所配置的密码登录。后端默认监听 5000，前端开发服务默认监听 5173。

```bash
curl http://127.0.0.1:5000/health
# {"status":"ok"}
```

健康检查只确认 HTTP 服务可响应，不校验数据库或外部考勤来源。

完成配置和初始化后，Mac / Linux 也可运行 `VENV_DIR=.venv bash macrun2.sh` 同时启动前后端；按 Ctrl+C 停止。脚本默认使用 `.venv-mac2`，会安装依赖并开启后端调试，但不会初始化数据库或管理员，仅用于开发。

## 配置说明

后端从项目根目录 `.env` 加载配置。以下配置中，初始管理员密码、部署向导密码和部分运行参数需自行添加到示例文件。

| 配置 | 用途与默认行为 |
| --- | --- |
| `SECRET_KEY` | 必填；用于 JWT 等签名，缺失或使用已知不安全占位符时拒绝启动 |
| `INITIAL_ADMIN_PASSWORD` | 首次执行 `init-admin` 时必填 |
| `DATABASE_URL` | 默认 `sqlite:///attendance.db`；MySQL 使用 `mysql+pymysql://…` |
| `APP_ENV` | 默认 `development`；生产部署设为 `production` |
| `FLASK_DEBUG` | `python app.py` 仅在显式设为 `1` 时开启调试；生产环境不要开启 |
| `JWT_EXPIRES_HOURS` | 普通登录令牌有效期，默认 12 小时 |
| `FRONTEND_ORIGINS` | 逗号分隔的前端来源白名单，供 CORS 与写请求 Origin/Referer 校验使用 |
| `FRONTEND_ORIGIN` | 未设置多来源白名单时使用的单值配置，默认 `http://localhost:5173` |
| `FRONTEND_APP_URL` | 前端地址配置，默认取白名单首项；开发脚本也会设置该值 |
| `SESSION_COOKIE_NAME` | 认证 Cookie 名，默认 `access_token` |
| `SESSION_COOKIE_SAMESITE` | 默认 `Lax` |
| `SESSION_COOKIE_SECURE` | 默认 `false`；HTTPS 部署设为 `true` |
| `SETUP_PASSWORD` | 数据库向导独立访问密码；向导接口直接读取根目录 `.env` 中的此值 |
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_CORP_ID` | 启用钉钉同步时必填，仅在服务端使用 |
| `UPLOAD_FOLDER` | 默认 `static/uploads` |
| `CALC_PROGRESS_DIR` | 默认 `instance/calc_progress` |
| `LOG_DIR` | 默认 `logs`，后端未处理异常写入轮转的 `error.log` |

前端环境变量在 `frontend/` 中配置：`VITE_BACKEND_TARGET` 控制开发与预览服务的代理目标，默认 `http://127.0.0.1:5000`；`VITE_API_BASE_URL` 控制浏览器请求的 API 基础地址，默认空值，使用同源路径。前端构建配置变化后需重新构建，勿在 `VITE_*` 中存放连接密钥。

## 月度账套与导入流程

建议按以下顺序处理每月数据：

1. 维护部门、班次与员工资料，核对工号、人员类型、统计来源和班次分配。
2. 在账套中心创建 `YYYY-MM` 月份账套，设置厂休（全天/上午/下午）与每月福利天数，按需激活。
3. 本地来源上传原始报表；外部来源先配置和测试连接，再按账套月份同步。
4. 执行员工、管理人员或全部的“重新计算”，检查各文件导入结果和同步结果。**上传原始文件仅归档，不等于已导入业务数据。**
5. 核对查询结果、处理每日或月度修正、迟到抵扣及年度统计，导出报表。
6. 确认后锁定账套；需要修改、同步、重新计算或恢复时先解锁。

### 原始报表识别

账套原始报表按文件名关键字识别，优先级如下：

| 文件名特征 | 类型 | 示例 |
| --- | --- | --- |
| 包含“加班” | 加班单 | `加班单.xlsx` |
| 包含“请假” | 请假单 | `请假单查询.xlsx` |
| 包含“管理人员”和“月报” | 管理人员月报 | `2026_8月管理人员基础数据(月报).xls` |
| 包含“管理人员” | 管理人员日报 | `2026_8月管理人员基础数据(日报).xls` |
| 包含“月报” | 员工月报 | `2026_8月员工基础数据(月报).xls` |
| 其余 | 员工日报 | `2026_8月员工基础数据(日报).xls` |

上述示例用于说明命名规则，内容仍须符合解析器所需表头。日报与月报文件名必须含可识别年月（如 `2026_8月` 或 `2026年8月`），并与账套月份一致；请假单和加班单不要求文件名带月份。系统还会拦截部分将日报改名为月报的错误上传。

同一账套同一类型只保留一个归档槽位，再次上传会替换该类型的旧归档。原始报表解析支持 `.xlsx` 与 `.xls`；基础资料、修正项和年度统计的专用导入请使用对应页面下载的模板，不能套用上述命名规则。

## 考勤来源与统计口径

### 本地报表与人员统计来源

员工日报和管理人员日报可以保存在同一日记录的不同来源载荷中。每位员工可分别配置员工统计与管理人员统计使用的来源（员工、管理人员或自动回退），并设置是否参与管理人员统计。

“打卡天数”与业务上的“出勤天数”是不同指标：当日有至少一次真实刷卡，实际打卡口径记 1 天；每日“实际打卡”人工标记优先，可明确计入或排除。工时、请假、厂休、福利、加班、迟到早退与月度修正共同参与业务统计。具体计算以 [查询汇总](routes/query_core.py)、[管理人员统计](services/manager_attendance_service.py) 和 [每日修正](services/daily_override_service.py) 的实现为准。

### 员工考勤机数据库

在后台“考勤来源设置”（`/admin/attendance-source`）将员工来源切换为考勤机数据库，填写 SQL Server 主机、端口（默认 1433）、数据库、用户名和密码，并测试连接。

当前客户端针对 STCard 表结构：`KQ_BrushCard`、`ST_Person`、`ST_Department`，通过 `pymssql` 读取当月记录。匹配优先使用员工工号，未匹配时尝试卡号；无法对应本地员工的记录列入未匹配报告。系统提供同步进度、历史和 CSV 下载。

员工来源为 `card_db` 时，重新计算会先同步考勤机数据，并跳过本地员工日报；员工月报、请假单和加班单仍参与相应处理。此 SQL Server 是外部考勤来源，与应用自身的 SQLite/MySQL 数据库分开配置。

### 管理人员钉钉

在 `.env` 配置三项钉钉凭证，并在钉钉应用中授权考勤记录及组织通讯录读取权限，覆盖所需部门和用户。应用对应企业须与 `DINGTALK_CORP_ID` 一致。

在“考勤来源设置”将管理人员来源切换为钉钉，测试连接后按账套月份同步。系统按工号匹配本地管理人员；未填写 `dingtalk_user_id` 时，会通过通讯录按工号解析，仅在本次处理内使用，不回写员工资料。无法匹配的记录跳过并列入同步结果，可从历史下载 CSV。

钉钉模式下，当月有成功或部分成功同步时，管理人员统计采用每日打卡数据；重新计算跳过本地管理人员日报和月报。未匹配人员不会通过旧 Excel 月报兜底，应核对工号与权限后重新同步。切回 `local` 后使用本地归档报表流程。

## 账号与权限

登录使用 JWT，浏览器请求携带认证 Cookie；写接口同时校验 Origin/Referer。生产来源白名单必须包含用户实际访问的协议、主机和端口。

- 管理员可访问后台和全部查询页面。
- 查询账号的页面入口由 `page_permissions` 控制，数据范围由员工分配和部门分配控制；仅开放页面并不代表可查询全部人员。
- 对绑定了 `profile_emp_no` 的管理人员，部分本人查询支持按绑定工号访问，无需额外员工分配。
- 离职处理会联动相关账号停用；复职支持解除相应离职锁定。
- 登录失败累计到 5 次时临时锁定 10 分钟，到 10 次时需管理员解锁。

页面与数据权限在后端也进行校验，不能仅依赖前端路由保护。

## 账套备份与恢复

在账套中心进入“账套设置 → 账套导入与导出”，按月份导出 ZIP。导出覆盖月参数、厂休、每日/月度考勤、人工修正与历史、与当月重叠的请假及加班单、同步历史、归档文件，以及关联员工、部门、班次和年度统计。缺失归档文件时会提示文件名并阻止生成完整备份；导出过程展示读取、打包、校验和下载进度。

导入 ZIP 后先预览系统值、备份值和数值差额：

- 员工、部门、班次和年度资料可分别选择导入，默认沿用系统现有资料。缺少引用时，先勾选对应资料或在系统补齐。
- 冲突支持批量或逐条选择系统值/备份值。默认保留系统独有记录；只有勾选“使当月独有数据与备份一致”才生成当月数据删除清单。
- 跨月单据、共享资料和年度资料不会因为备份中缺失而被删除。最终确认列出新增、更新、删除数量及跨月影响。
- 预览后目标数据发生变化，需要重新查看差异；锁定账套需先解锁。恢复不会切换激活账套，也不会导入账号、权限或连接密钥。
- 数据库和新归档写入失败时回滚，保留旧文件。上传 ZIP 上限 100 MiB，解压总量上限 500 MiB；预览有效期 1 小时，仅上传管理员可访问。

月度账套 ZIP 用于业务资料交换与恢复。整站备份还应覆盖应用数据库、上传目录和 `.env`，并单独妥善保管其中的账号数据和连接凭证。

## 数据库初始化与迁移

### 建表和版本升级

```bash
# 新环境：空库创建模型表并记录最新迁移版本；非空库执行迁移
python -m flask --app manage.py init-db

# 创建初始管理员
python -m flask --app manage.py init-admin

# 历史库：补齐兼容表与字段
python -m flask --app manage.py upgrade-legacy-schema

# 查看版本 / 执行 Alembic 增量升级
python -m flask --app manage.py db current
python -m flask --app manage.py db upgrade
```

升级前备份数据库与归档文件。最早的基线迁移假定表已存在，新空库应使用 `init-db`，不能直接以 `db upgrade` 代替。`upgrade-legacy-schema` 负责历史兼容补丁，不能替代所有后续 Alembic 迁移。备份来源与恢复审计表由 `20261007_backup` 迁移创建。

部分旧库的 Alembic 版本长期停在 `681e8410935f`，但已由兼容补丁创建后续对象；直接升级可能遇到重复表/列。Ubuntu 的 `update.sh` 对该版本包含先补齐兼容结构、再对齐到 `b8c9d0e1f2a3`、最后增量升级的处理。其他环境遇到此历史状态时，应先核对实际结构再处理版本号。

### SQLite / MySQL 部署向导

数据库向导在前端 `/database-setup`（本地为 <http://localhost:5173/database-setup>），使用独立密码解锁，无需先登录管理员。先在根目录 `.env` 增加 `SETUP_PASSWORD`。

1. 准备目标 MySQL 空数据库，填写连接参数并暂存配置。
2. 测试连接，执行 SQLite → MySQL 迁移并检查逐表结果。
3. 核对数据后切换到 MySQL，重启后端生效。

向导也提供 MySQL → SQLite 迁移和数据库切换。**当前迁移服务使用固定表清单，未覆盖消息、每日修正及账套备份来源/恢复审计等新表**；切库前须按 [迁移服务清单](services/migration_service.py) 核对并补充未覆盖数据。迁移与切换是两个步骤，切换连接不会自动复制数据或归档文件。

MySQL 故障导致应用无法启动时，可在根目录运行：

```bash
python switch_sqlite.py
```

该脚本交互确认后备份 `.env` 为 `.env.bak`，将连接改为 `sqlite:///attendance.db`，需重启生效。它不迁移 MySQL 最新数据；只有确认本地 SQLite 数据可用后才应切换。MySQL → SQLite 向导当前写入根目录 `attendance.db`，与默认连接解析到的 `instance/attendance.db` 路径不同，切换前须核实并对齐实际文件。

## 生产部署与运维

### 通用要求

前端先执行 `npm ci && npm run build`，发布 `frontend/dist`。Web 服务器需支持 SPA 路由回退到 `index.html`，并代理 `/api/`。按实际网站地址设置 `FRONTEND_ORIGINS`；启用 HTTPS 时设置 `SESSION_COOKIE_SECURE=true`。

账套计算和同步包含长请求，应同时配置应用服务器与反向代理超时。上传完整备份时代理请求体上限需覆盖 ZIP 和 multipart 开销。`/health` 默认不在现有 Nginx 的 `/api/` 代理范围内，可直接访问后端进行健康检查。

### Ubuntu：Nginx + Systemd + Gunicorn

仓库部署示例约定目录 `/var/www/mtemphub`、服务名 `attendance_api`、运行用户 `mt`。部署到其他目录或使用其他用户时，应同步调整服务与脚本。

完成 `.env` 配置与数据库初始化后，安装 Gunicorn 并构建前端：

```bash
cd /var/www/mtemphub
source .venv/bin/activate
python -m pip install gunicorn
cd frontend
npm ci
npm run build
```

以 [Systemd 示例](scripts/ubuntu/attendance_api.service) 和 [Nginx 示例](scripts/ubuntu/attendance_nginx) 为基础安装服务。Systemd 独立模板没有长请求超时参数，应按需要在 Gunicorn 启动命令中增加 `--timeout 600`；Nginx 示例已有 `proxy_read_timeout 600`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now attendance_api
sudo nginx -t
sudo systemctl reload nginx
curl http://127.0.0.1:5000/health
```

[scripts/ubuntu/deploy_15.sh](scripts/ubuntu/deploy_15.sh) 可参考其部署步骤，但仍包含 Node 18 安装逻辑、固定用户与路径，且不会为你完成必需的 `.env` 配置；运行前需调整环境。当前前端依赖要求见“本地开发”。

已有上述部署结构时：

```bash
# 用部署用户运行，脚本拒绝 root；内部按需调用 sudo
bash /var/www/mtemphub/update.sh
bash /var/www/mtemphub/restart.sh

sudo systemctl status attendance_api
sudo journalctl -u attendance_api -n 50
```

`update.sh` 固定从 `origin master` 快进拉取，更新依赖、处理数据库升级、构建前端、重启并做健康检查；还会丢弃 `frontend/package-lock.json` 的本地修改。路径、分支或服务名不一致时先调整脚本。

### Windows：Waitress + NSSM

准备 Python 3.12、构建前端所需 Node.js，以及 NSSM。先在项目目录配置 `.env` 的安全密钥、初始管理员密码和生产前端来源，再使用管理员 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_production.ps1 `
  -ProjectRoot "D:\MTEmpHub" `
  -InstallService `
  -NssmPath "C:\tools\nssm\win64\nssm.exe"
```

该入口准备后端虚拟环境、初始化数据库与管理员，并注册 `attendance-system` 服务（默认端口 5000）。历史库可增加 `-UpgradeLegacySchema`。**它不构建或托管 React 前端**，前端需单独构建并由 Web 服务器发布、代理 API。

服务管理入口：`scripts/windows/run_service_manager.bat`；可通过 `scripts/windows/build_service_manager_exe.bat` 打包管理器。服务输出位于 `logs/service-stdout.log` 和 `logs/service-stderr.log`。

无 NSSM 时可直接运行后端：

```bash
python -m waitress --host=0.0.0.0 --port=5000 wsgi:app
```

`winrun.sh` 适用于 Git Bash，默认使用 `.venv-win-prod`，后端端口 5001、前端预览端口 4173，执行初始化和前端构建后启动 Waitress + Vite preview。使用前仍需准备 `.env`，并将实际访问的 4173 前端来源加入白名单；长期生产发布按前述静态站点方式部署。

### 整站备份与回滚

Windows 提供文件级辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup_state.ps1 -ProjectRoot "D:\MTEmpHub"
powershell -ExecutionPolicy Bypass -File .\scripts\windows\rollback_state.ps1 -ProjectRoot "D:\MTEmpHub" -BackupDir "D:\MTEmpHub\backups\指定备份目录"
```

备份脚本复制 `.env`、`instance/attendance.db` 与 `static/uploads`。数据库路径或上传目录自定义时需调整备份范围；MySQL 应使用数据库自身备份工具。备份和回滚期间停止写入，并核对数据库与归档来自同一时间点。

## 开发验证与常见问题

### 测试与构建

后端测试依赖 pytest，未包含在生产 `requirements.txt` 中：

```bash
python -m pip install pytest
python -m pytest tests -q
```

前端：

```bash
cd frontend
npm ci
npm test
npm run build
```

后端测试覆盖启动、认证与权限、CSRF、查询统计、导入、人工修正、迟到抵扣、钉钉/考勤机同步、数据库迁移及账套备份恢复；前端使用 Vitest 与 Testing Library 验证组件、API 客户端、交互和样式边界。

### 排查入口

| 现象 | 检查方向 |
| --- | --- |
| 启动提示密钥无效 | 替换 `.env` 中 `SECRET_KEY` 的示例占位符 |
| `init-admin` 提示未配置密码 | 增加 `INITIAL_ADMIN_PASSWORD`；已有账号不会由该命令重置密码 |
| `no such table` / 缺字段 | 新库执行 `init-db`；旧库核对兼容升级与 Alembic 版本 |
| 登录或保存返回“跨站请求校验失败” | 检查 `FRONTEND_ORIGINS` 是否包含实际来源；命令行调用写 API 也需携带合法 Origin/Referer |
| 上传后查询无变化 | 上传仅归档，继续执行对应账套“重新计算”，检查导入明细 |
| 重新计算或导入被拒绝 | 检查账套是否锁定，以及文件名年月与账套月份 |
| 同步有未匹配记录 | 核对工号、卡号/钉钉用户、人员类型与统计来源，下载未匹配 CSV |
| 413 / 504 | 检查代理上传大小，以及代理与应用服务器的长请求超时 |
| 完整备份提示归档缺失 | 核对上传目录、归档路径及文件是否仍存在 |
| 页面刷新后 404 | 检查生产静态服务器是否配置 SPA 回退 |
| 后端 500 | 查看 `logs/error.log` 以及 Systemd 或 Windows 服务日志 |

## 开源协议

本项目使用 [MIT License](LICENSE)。

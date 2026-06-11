# MtEmployeeAttendance System

基于 Flask 的员工考勤管理系统，覆盖员工考勤查询、管理人员统计、Excel 导入、后台管理，以及 Windows 环境下的服务化部署。

## 功能概览

- 员工考勤、异常、打卡、部门工时查询
- 管理人员考勤、加班、年休、部门工时查询
- Excel 数据导入与汇总
- 管理后台账号、部门、班次、修正项维护
- 数据库设置页面：MySQL 连接配置、测试连接、数据迁移、切回 SQLite
- Windows 服务安装、托盘管理、备份与回滚

## 快速开始

如果你是第一次在本地运行这个项目，先看这一节。

### 环境要求

- Python 3.12
- `pip`
- SQLite
- Windows 部署场景额外需要 `NSSM`

### 安装依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### 初始化数据库

新环境第一次启动前，执行：

```bash
flask --app manage.py init-db
```

这一步会：

- 创建当前模型所需表结构
- 执行旧版本数据库兼容升级逻辑

### 初始化管理员

首次使用需要创建默认管理员：

```bash
flask --app manage.py init-admin
```

默认管理员账号由代码初始化逻辑生成，默认用户名为 `admin`。

### 旧数据库升级

如果你手里已经有历史版本的 `attendance.db`，不要依赖应用启动时自动升级。请在启动前显式执行：

```bash
flask --app manage.py upgrade-legacy-schema
```

注意：

- 应用启动本身不会再隐式执行 schema 升级
- `upgrade-legacy-schema` 只用于已有旧库补历史字段或表

### 本地开发启动

```bash
# 推荐：Mac 一键同时启动前后端
chmod +x macrun2.sh
./macrun2.sh

# 或者手动分开启动

# 终端 1：后端 API
python3 app.py

# 终端 2：独立前端
cd frontend
npm install
npm run dev
```

注意：

- 后端默认提供 `http://127.0.0.1:5000`
- 前端默认提供 `http://127.0.0.1:5173`
- `./macrun2.sh` 会自动准备 Python 虚拟环境、安装依赖，并同时启动 Flask API 和 Vite 前端
- `python3 app.py` 仅用于本地开发
- 这会启动 Flask development server，不适合生产环境

### 健康检查

启动后可以验证服务是否正常：

```bash
curl http://127.0.0.1:5000/health
```

预期返回：

```json
{"status":"ok"}
```

## 常用命令

```bash
# 新环境初始化
flask --app manage.py init-db

# 初始化默认管理员
flask --app manage.py init-admin

# 旧数据库兼容升级
flask --app manage.py upgrade-legacy-schema

# 本地开发启动
./macrun2.sh

# 启动独立前端
cd frontend && npm install && npm run dev

# 生产启动
python -m waitress --host=0.0.0.0 --port=5000 wsgi:app

# 运行测试
python3 -m pytest -q

# MySQL 连不上时切回 SQLite（安全网，不依赖 Flask）
python switch_sqlite.py
```

## 项目结构

如果你准备改代码，先看这一节定位文件。

- `app.py`
  Flask 应用工厂与本地开发入口
- `manage.py`
  CLI 初始化与旧库升级命令
- `models/`
  数据模型定义
- `routes/api_auth.py`
  认证 API
- `routes/api_query.py`
  查询中心 API
- `routes/api_admin.py`
  管理后台 API
- `routes/query_core.py`
  查询 API 复用业务逻辑
- `routes/admin_core.py`
  管理 API 复用业务逻辑
- `services/`
  业务逻辑、导入处理、统计汇总
- `frontend/`
  React/Vite 独立前端工程
- `tests/`
  回归测试与功能测试
- `docs/`
  设计与计划文档

## 前后端分离说明

- 浏览器业务入口只由 `frontend/` 独立前端提供
- Flask 只提供 `/api/auth/*`、`/api/query/*`、`/api/admin/*` 与 `/health`
- 后端不再提供 `/login`、`/employee/*`、`/admin/*`、`/module/*` 页面或兼容跳转
- 本地默认前端地址可通过 `FRONTEND_APP_URL` 或 `FRONTEND_ORIGIN` 调整
- 生产环境建议将前端部署到独立站点，将后端作为 API 服务部署

## 权限与人员范围说明

- 页面是否可访问，取决于用户的 `page_permissions`
- 员工类查询的数据范围，取决于账号绑定的员工分配和部门分配
- 管理人员类查询的数据范围，默认同样受员工分配和部门分配控制
- 对于“管理人员自查”场景，如果账号档案已绑定 `profile_emp_no`，则管理人员考勤、加班、年休、部门工时查询会额外放行该工号对应的管理人员数据

这意味着：

- 一个只绑定了 `profile_emp_no`、但没有单独配置员工分配关系的管理人员账号，仍然可以查询自己的管理人员数据
- 如果需要查询其他管理人员的数据，仍然需要通过员工分配或部门分配显式授权

## Excel 导入说明

如果你负责导入考勤源文件，先看这一节。

后台当前支持导入的典型文件包括：

- `加班单.xlsx`
- `请假单查询.xlsx`
- `2026_3月员工基础数据.xls`
- `2026_3月员工基础数据(月报).xls`

解析方式：

- `.xlsx` 使用 `openpyxl`
- `.xls` 使用 `xlrd`

## Windows 部署与运维

如果你要把系统部署到 Windows 主机，直接看这一节。

### 1. 前置准备

- 安装 Python 3.12，并勾选 `Add Python to PATH`
- 安装 NSSM，推荐路径：`C:\tools\nssm\win64\nssm.exe`
- 把项目复制到目标机器，例如：`D:\attendance_system`

### 2. 首次部署

推荐直接运行引导脚本：

```powershell
cd D:\attendance_system
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap_windows.ps1 -ProjectRoot "D:\attendance_system" -InitEnv
```

如果网络环境有 SSL 或镜像限制：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap_windows.ps1 -ProjectRoot "D:\attendance_system" -InitEnv -PipIndexUrl "https://pypi.tuna.tsinghua.edu.cn/simple" -PipTrustedHost "pypi.tuna.tsinghua.edu.cn"
```

如果你希望把“初始化环境 + 建库 + 初始化管理员 + 安装服务”合并成一条命令，推荐直接使用新的生产部署脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_production.ps1 -ProjectRoot "D:\attendance_system" -InstallService
```

如果你是在 Git Bash 或者习惯用和 `./winrun.sh` 一样的入口，也可以直接在项目根目录执行：

```bash
INSTALL_SERVICE=1 ./winrun_deploy.sh
```

旧数据库机器可以这样执行：

```bash
UPGRADE_LEGACY_SCHEMA=1 INSTALL_SERVICE=1 ./winrun_deploy.sh
```

如果目标机器使用的是历史版本数据库，再额外加上：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_production.ps1 -ProjectRoot "D:\attendance_system" -UpgradeLegacySchema -InstallService
```

### 3. 手动初始化与生产启动

需要手动冒烟验证时，可以执行：

```powershell
.\.venv-win-prod\Scripts\python.exe -m flask --app manage.py init-db
.\.venv-win-prod\Scripts\python.exe -m flask --app manage.py init-admin
.\.venv-win-prod\Scripts\python.exe -m waitress --host=0.0.0.0 --port=5000 wsgi:app
```

如果目标主机上的数据库来自旧版本，先补一次兼容升级：

```powershell
.\.venv-win-prod\Scripts\python.exe -m flask --app manage.py upgrade-legacy-schema
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health
```

等价的通用生产命令：

```bash
flask --app manage.py init-db
flask --app manage.py init-admin
flask --app manage.py upgrade-legacy-schema   # 仅旧数据库需要
python -m waitress --host=0.0.0.0 --port=5000 wsgi:app
```

注意：

- 生产环境不要使用 `python app.py`
- 生产环境应使用 `waitress`

### 4. 安装为 Windows 服务

```powershell
cd D:\attendance_system
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install_service.ps1 -ProjectRoot "D:\attendance_system" -ServiceName "attendance-system" -Port 5000 -NssmPath "C:\tools\nssm\win64\nssm.exe"
```

服务启动后建议立即检查：

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health
```

### 5. 托盘管理器

准备好 Python 和 NSSM 后，可以直接启动托盘管理器：

```powershell
cd D:\attendance_system
.\scripts\windows\run_service_manager.bat
```

托盘菜单支持：

- 启动服务
- 停止服务
- 重启服务
- 修改端口

补充说明：

- 托盘管理器底层仍然使用 `waitress + nssm`
- Windows 下控制服务通常需要管理员权限
- 当前端口配置保存在 `instance\windows_service_manager.json`

### 6. 打包为 EXE

```powershell
cd D:\attendance_system
.\scripts\windows\build_service_manager_exe.bat
```

或者：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\build_service_manager_exe.ps1 -ProjectRoot "D:\attendance_system"
```

默认输出：

```text
D:\attendance_system\dist\windows-service-manager\AttendanceServiceManager.exe
```

补充说明：

- 打包脚本依赖 PowerShell 模块 `ps2exe`
- 如果缺失，脚本会默认尝试为当前用户安装
- 生成的 EXE 为 GUI/后台程序，不会弹控制台窗口

### 7. 备份与回滚

备份：

```powershell
cd D:\attendance_system
powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup_state.ps1 -ProjectRoot "D:\attendance_system"
```

备份内容包括：

- `.env`
- `instance\attendance.db`
- `static\uploads`

回滚：

```powershell
cd D:\attendance_system
powershell -ExecutionPolicy Bypass -File .\scripts\windows\rollback_state.ps1 -ProjectRoot "D:\attendance_system" -BackupDir "D:\attendance_system\backups\20260423_120000"
```

回滚后重启服务：

```powershell
C:\tools\nssm\win64\nssm.exe restart attendance-system
```

### 8. 服务日志

- `D:\attendance_system\logs\service-stdout.log`
- `D:\attendance_system\logs\service-stderr.log`

## Ubuntu 部署与运维

如果你准备将本系统部署到 Linux (Ubuntu) 服务器上，这是最推荐的生产级方案（**Nginx + Systemd + Waitress/Gunicorn**）。

### 1. 前置环境准备

在服务器上安装 Python3、虚拟环境工具以及 Nginx：

```bash
sudo apt update
sudo apt install python3 python3-venv python3-pip nginx -y
```

> **提示**：如果是前端也需要在服务器端打包，还需要安装 Node.js (推荐通过 nvm 或 nodesource 安装 Node >= 18)。

### 2. 获取代码与后端初始化

将代码拉取到服务器，例如放到 `/var/www/attendance_system`：

```bash
cd /var/www/attendance_system

# 创建并激活虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
# (推荐) Linux 生产环境下可额外安装 gunicorn 替代 waitress
pip install gunicorn

# 准备环境变量
cp .env.example .env
nano .env # 填入你的 SETUP_PASSWORD 及其它配置

# 数据库初始化与管理员创建
flask --app manage.py init-db
flask --app manage.py init-admin
```

### 3. 前端构建部署

在开发机或者直接在服务器上构建前端静态文件：

```bash
cd frontend
npm install
npm run build
```

构建完成后，会生成 `dist/` 文件夹。

### 4. 配置 Systemd 守护进程 (后端开机自启)

创建服务配置文件：

```bash
sudo nano /etc/systemd/system/attendance_api.service
```

写入以下内容（注意替换 `/var/www/attendance_system` 为你的实际路径，并修改 `User` 为你的实际系统用户名）：

```ini
[Unit]
Description=Attendance System Backend API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/var/www/attendance_system
Environment="PATH=/var/www/attendance_system/.venv/bin"
# 如果使用 waitress:
ExecStart=/var/www/attendance_system/.venv/bin/waitress-serve --host=127.0.0.1 --port=5000 wsgi:app
# 如果使用 gunicorn (推荐):
# ExecStart=/var/www/attendance_system/.venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app

Restart=always

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl start attendance_api
sudo systemctl enable attendance_api
```

### 5. 配置 Nginx 反向代理

Nginx 负责直接吐出前端静态文件，并将 `/api` 的请求转发给后端的 5000 端口。

```bash
sudo nano /etc/nginx/sites-available/attendance
```

写入以下配置：

```nginx
server {
    listen 80;
    server_name your_domain_or_ip;

    # 1. 代理前端静态文件
    root /var/www/attendance_system/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 2. 代理后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置并重启 Nginx：

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # (可选) 移除默认配置
sudo nginx -t
sudo systemctl restart nginx
```

### 6. 完成！
现在你可以在浏览器通过服务器的 IP 访问系统。
如果是第一次部署并且还没切 MySQL，可以直接访问 `http://<服务器IP>/database-setup` 用你的 `SETUP_PASSWORD` 解锁页面，按引导连上本机的 MySQL 进行一键部署迁移！

## 开发与测试

如果你准备继续维护项目，先看这一节。

### 运行测试

```bash
python3 -m pytest -q
```

### 启动相关注意事项

- 应用启动不会隐式执行 schema 升级
- 新环境初始化走 `init-db`
- 旧库升级走 `upgrade-legacy-schema`
- 生产启动使用 `waitress`

### 关于 migrations

项目已启用 Flask-Migrate（基于 Alembic）。`init-db` 命令会通过 migration 创建表结构。

- 新环境：使用 `init-db`（内部执行 `flask db upgrade`）
- 旧环境：升级前显式运行 `upgrade-legacy-schema`
- 后续 Model 变更后：执行 `flask db migrate -m "描述"` 生成迁移脚本，再 `flask db upgrade` 应用

## 数据库部署向导（SQLite 到 MySQL 迁移）

系统默认使用 SQLite，且提供了一个独立的、无须后台登录的【部署向导页面】来支持一键切换和迁移到 MySQL。

### 安全要求

> **注意**：为了防止部署环境泄露，数据库部署页面配有一道强力“密码锁”。

在使用前，你**必须**在项目根目录的 `.env` 文件中配置向导访问口令：

```bash
SETUP_PASSWORD=你的任意解锁密码
```

### 部署操作流程

1. 在浏览器直接访问独立部署向导页面：`http://127.0.0.1:5173/database-setup`
2. 输入你在 `.env` 中配置的 `SETUP_PASSWORD` 解锁页面。
3. 页面分为三个核心区域，支持无缝的“边测边迁”：
   - **当前连接**：显示应用目前正在运行的数据库状态。
   - **MySQL 配置**：
     - 填写 MySQL 信息后，点击「暂存配置」（配置只存在后台备用箱，不会导致当前系统断开）。
     - 点击「测试连接」验证连通性。
   - **数据迁移**：
     - 点击「开始迁移」，系统会读取刚暂存的配置，自动建表并将旧库所有数据完美拷贝到新 MySQL 中。
   - **一键切换**：
     - 迁移成功确认无误后，在配置区点击「切换到 MySQL」，此时新配置才会正式覆盖生效，重启应用后完成彻底换库。

### 方式二：手动修改 `.env`

```bash
# SQLite（默认）
DATABASE_URL=sqlite:///attendance.db

# MySQL
DATABASE_URL=mysql+pymysql://user:password@host:3306/attendance_db?charset=utf8mb4
```

### ⚠️ MySQL 连不上怎么办

如果 MySQL 配置有误导致应用无法启动或登录失败，在终端执行：

```bash
python switch_sqlite.py
```

此脚本不依赖 Flask，直接修改 `.env` 文件切回 SQLite，执行后重启应用即可恢复。

### MySQL 环境要求

- MySQL 版本 >= 5.7（需支持 JSON 字段），推荐 8.0+
- 字符集必须为 `utf8mb4`
- 提前创建好空数据库：
  ```sql
  CREATE DATABASE attendance_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

## 补充说明

项目中保留了一些面向 AI 编码代理的约束文件和集成配置，例如：

- `AGENTS.md`
- `CLAUDE.md`
- `.claude-plugin/`

这些内容不影响系统运行，主要用于辅助代码代理工具在本仓库内遵循统一开发约束。

## 启动命令

chmod +x /Users/lewis/Lewis/code/git/MtEmployeeAttendance-System/macrun2.sh
/Users/lewis/Lewis/code/git/MtEmployeeAttendance-System/macrun2.sh

# MtEmployeeAttendance System

基于 Flask 的员工考勤管理系统，覆盖员工考勤查询、管理人员统计、Excel 导入、后台管理，以及 Windows 环境下的服务化部署。

## 功能概览

- 员工考勤、异常、打卡、部门工时查询
- 管理人员考勤、加班、年休、部门工时查询
- Excel 数据导入与汇总
- 管理后台账号、部门、班次、修正项维护
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
```

## 项目结构

如果你准备改代码，先看这一节定位文件。

- `app.py`
  Flask 应用工厂与本地开发入口
- `manage.py`
  CLI 初始化与旧库升级命令
- `models/`
  数据模型定义
- `routes/`
  路由与接口入口
- `services/`
  业务逻辑、导入处理、统计汇总
- `frontend/`
  React/Vite 独立前端工程
- `templates/`
  历史模板资源与导出模板
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

仓库当前保留了 `migrations/` 目录，但旧库兼容逻辑仍在显式命令中维护。当前建议是：

- 新环境：使用 `init-db`
- 旧环境：升级前显式运行 `upgrade-legacy-schema`
- 后续如需完全迁移到 Flask-Migrate/Alembic，再单独做结构化迁移整理

## 补充说明

项目中保留了一些面向 AI 编码代理的约束文件和集成配置，例如：

- `AGENTS.md`
- `CLAUDE.md`
- `.claude-plugin/`

这些内容不影响系统运行，主要用于辅助代码代理工具在本仓库内遵循统一开发约束。

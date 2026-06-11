# MTEmpHub 综合服务平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 Flask 的员工综合服务平台，覆盖员工考勤查询、菜票等后勤管理、管理人员统计、Excel 导入、后台管理，以及 Windows/Linux 环境下的服务化部署。

## 📖 目录

- [功能概览](#功能概览)
- [快速开始 (本地开发)](#快速开始-本地开发)
- [项目结构](#项目结构)
- [核心业务说明](#核心业务说明)
- [数据库迁移配置](#数据库迁移配置)
- [部署与运维 (Windows & Ubuntu)](#部署与运维-windows--ubuntu)
- [开源协议](#开源协议)

---

## 功能概览

- **员工端**：员工考勤、异常、打卡、部门工时查询。
- **管理端**：管理人员考勤、加班、年休、部门工时查询；Excel 数据导入与汇总。
- **后台管理**：管理后台账号、部门、班次、修正项维护。
- **系统设置**：数据库设置页面（MySQL 连接配置、测试连接、数据迁移、一键切换回 SQLite）。
- **自动化部署**：Windows 服务安装、托盘管理、备份与回滚；Ubuntu Nginx+Systemd 推荐方案。

---

## 快速开始 (本地开发)

如果你是第一次在本地运行这个项目，请参考以下步骤：

### 1. 环境准备与依赖安装
- Python 3.12, `pip`
- SQLite (默认) 或 MySQL

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### 2. 数据库与管理员初始化
```bash
# 新环境初始化 (创建表结构)
flask --app manage.py init-db

# 首次使用需创建默认管理员 (默认账号 admin)
flask --app manage.py init-admin

# 如果已有历史版本的 attendance.db，请在启动前执行旧版本数据库兼容升级：
flask --app manage.py upgrade-legacy-schema
```

### 3. 本地启动服务
```bash
# 推荐：Mac/Linux 一键同时启动前后端
chmod +x macrun2.sh
./macrun2.sh

# 手动分开启动：
# 终端1：python3 app.py (后端运行在 5000 端口)
# 终端2：cd frontend && npm install && npm run dev (前端运行在 5173 端口)
```

**健康检查**：`curl http://127.0.0.1:5000/health` (预期返回 `{"status":"ok"}`)

---

## 项目结构

- **后端**
  - `app.py`：Flask 应用工厂与本地开发入口。
  - `manage.py`：CLI 初始化与旧库升级命令。
  - `models/`：数据模型定义。
  - `routes/`：API 路由定义 (认证、查询、管理、通用核心逻辑)。
  - `services/`：业务逻辑、导入处理、统计汇总。
- **前端**
  - `frontend/`：React/Vite 独立前端工程。
- **其他**
  - `tests/`：回归与功能测试。
  - `docs/`：设计与计划文档。
  - `scripts/`：各平台部署相关的自动化脚本。

---

## 核心业务说明

### 前后端分离架构
- 浏览器业务入口由 `frontend/` 提供，后端仅提供 `/api/*` 接口。
- 本地默认前端地址可通过 `FRONTEND_APP_URL` 调整。
- 生产环境建议前端部署到独立站点或 Nginx 代理，后端作为 API 服务。

### 权限与人员范围控制
- 页面访问由用户的 `page_permissions` 决定。
- 查询数据范围受账号绑定的 **员工分配** 和 **部门分配** 控制。
- 特殊场景：如果账号已绑定 `profile_emp_no`，管理人员可查询自己的对应数据，而无需额外的员工分配授权。

### Excel 导入支持
后台支持导入如下格式的文件（通过 `openpyxl` 和 `xlrd` 解析）：
- `加班单.xlsx`, `请假单查询.xlsx`
- `[年月]员工基础数据.xls` 等。

---

## 数据库迁移配置 (SQLite 到 MySQL)

系统默认使用 SQLite，提供独立的**部署向导页面** (`http://127.0.0.1:5173/database-setup`) 支持一键迁移到 MySQL。

**配置密码锁**：
在 `.env` 中配置 `SETUP_PASSWORD=你的密码` 后方可访问该向导页面。

**迁移流程**：
1. 访问部署向导页面并解锁。
2. 填写 MySQL 连接信息 -> 「暂存配置」 -> 「测试连接」。
3. 点击「开始迁移」完成数据导入。
4. 验证无误后，点击「切换到 MySQL」并重启应用生效。

如果 MySQL 无法连接导致应用无法启动，执行以下安全网脚本一键回滚：
```bash
python switch_sqlite.py
```

---

## 部署与运维 (Windows & Ubuntu)

<details>
<summary><b>点击展开 Windows 部署详细指南</b></summary>

### 1. 自动化安装与服务注册
- 安装 Python 3.12 (Add to PATH) 与 NSSM (例如 `C:\tools\nssm\win64\nssm.exe`)。
- 在项目根目录执行：
  ```powershell
  # 引导式安装、建库与注册服务
  powershell -ExecutionPolicy Bypass -File .\deploy_production.ps1 -ProjectRoot "D:\attendance_system" -InstallService
  ```

### 2. 托盘管理器
- 运行 `.\scripts\windows\run_service_manager.bat` 可在状态栏控制服务启停。
- 或执行 `.\scripts\windows\build_service_manager_exe.bat` 打包独立 EXE。

### 3. 备份与回滚
- 备份：`powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup_state.ps1 -ProjectRoot "D:\attendance_system"`
- 回滚：`powershell -ExecutionPolicy Bypass -File .\scripts\windows\rollback_state.ps1 -ProjectRoot "D:\attendance_system" -BackupDir "..."`
</details>

<details>
<summary><b>点击展开 Ubuntu 部署详细指南 (Nginx + Systemd + Waitress/Gunicorn)</b></summary>

### 1. 准备环境与初始化
```bash
sudo apt update && sudo apt install python3 python3-venv python3-pip nginx -y
cd /var/www/attendance_system
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt gunicorn
cp .env.example .env && nano .env
flask --app manage.py init-db && flask --app manage.py init-admin
```

### 2. 前端构建
```bash
cd frontend && npm install && npm run build
```

### 3. Systemd 守护进程 (后端)
创建 `/etc/systemd/system/attendance_api.service`，指定 Gunicorn 运行在本地 5000 端口。
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now attendance_api
```

### 4. Nginx 反向代理
配置 Nginx 代理前端静态资源，并将 `/api` 转发到 `127.0.0.1:5000`。
```bash
sudo systemctl restart nginx
```
### 5. 一键更新与重启
在部署完成后，你可以使用提供的一键脚本来管理应用更新和重启：
- **一键更新**：执行 `./scripts/ubuntu/update.sh` 会自动拉取代码、更新后端依赖、构建前端并重启服务。
- **一键重启**：执行 `./scripts/ubuntu/restart.sh` 可快速重启后端进程并重载 Nginx 配置。
</details>

---

## 常用命令备忘录

```bash
# 新环境初始化与默认管理员创建
flask --app manage.py init-db
flask --app manage.py init-admin

# 旧数据库兼容升级
flask --app manage.py upgrade-legacy-schema

# 生产级启动 (Waitress)
python -m waitress --host=0.0.0.0 --port=5000 wsgi:app

# 运行测试
python3 -m pytest -q
```

---

## 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。

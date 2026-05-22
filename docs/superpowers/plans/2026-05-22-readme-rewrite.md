# README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 README 重写为一份同时面向开发者和部署者的清晰综合文档。

**Architecture:** 保留单文件 README，不拆分到多个 docs。前半部分聚焦本地开发与常用命令，后半部分聚焦 Windows 部署与运维，并把 AI/插件说明压缩到结尾补充部分。

**Tech Stack:** Markdown、Flask CLI、Waitress、Windows PowerShell

---

### Task 1: 重写 README 结构

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-22-readme-rewrite-design.md`
- Modify: `docs/superpowers/plans/2026-05-22-readme-rewrite.md`

- [ ] **Step 1: 按设计稿重排 README 章节**

```text
1. 项目简介
2. 功能概览
3. 快速开始
4. 常用命令
5. 项目结构
6. Excel 导入说明
7. Windows 部署与运维
8. 开发与测试
9. 补充说明
```

- [ ] **Step 2: 突出开发者快速入口**

```text
在前半部分明确区分：
- 新环境初始化：`flask --app manage.py init-db`
- 管理员初始化：`flask --app manage.py init-admin`
- 旧库升级：`flask --app manage.py upgrade-legacy-schema`
- 本地开发启动：`python3 app.py`
- 生产启动：`python -m waitress --host=0.0.0.0 --port=5000 wsgi:app`
```

- [ ] **Step 3: 保留并压缩 Windows 运维说明**

```text
保留：
- 前置准备
- 首次部署
- 旧库升级
- 服务安装
- 托盘管理器
- EXE 打包
- 备份与回滚
```

### Task 2: 自检 README 内容

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 检查关键命令是否与当前实现一致**

Run: `rg -n "init-db|init-admin|upgrade-legacy-schema|waitress|python3 app.py" README.md`
Expected: README 中包含且语义正确。

- [ ] **Step 2: 检查章节结构是否完整**

Run: `rg -n "^## " README.md`
Expected: 章节顺序覆盖设计稿中的主要部分。

- [ ] **Step 3: 提交**

```bash
git add README.md docs/superpowers/specs/2026-05-22-readme-rewrite-design.md docs/superpowers/plans/2026-05-22-readme-rewrite.md
git commit -m "docs: rewrite project readme"
```

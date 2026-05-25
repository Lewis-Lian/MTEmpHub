# React 前端恢复旧版页面 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动现有 React 路由和 API 契约的前提下，把查询页、后台页和关键首页继续收口到旧版考勤系统的 UI 结构、层次和视觉语言。

**Architecture:** 继续保留当前 React 页面、路由和数据请求逻辑，把旧版 Flask 模板中的页面框架、筛选区、结果区、说明区和状态反馈翻译成 React 组件与样式。先统一公共层，再只对差异特别大的页面做逐页贴近，避免为相似页面重复堆叠结构。

**Tech Stack:** React 18、TypeScript、React Router、Vite、现有 `frontend/src/api/*` 数据层、定向抽取的旧版 CSS、Vitest

---

## 文件结构

**修改文件**

- `frontend/src/layouts/AppShell.tsx`
  - 旧版后台框架容器，承载顶部模块导航、侧栏、页签栏和内容区
- `frontend/src/components/nav/AppMenu.tsx`
  - 顶部模块导航、当前模块侧栏菜单、移动端底部导航
- `frontend/src/components/nav/AppTabs.tsx`
  - React 路由驱动的旧版页签条
- `frontend/src/components/query/QueryTable.tsx`
  - 旧版结果区表格
- `frontend/src/components/query/EmployeePicker.tsx`
  - 尽量向旧版“员工选择器”结构贴近
- `frontend/src/components/feedback/LoadingState.tsx`
  - 旧内容面板中的加载状态
- `frontend/src/components/feedback/ErrorState.tsx`
  - 旧内容面板中的错误状态
- `frontend/src/pages/query/QueryPage.tsx`
  - 通用查询页骨架，收口为旧版标题区、筛选区、结果区
- `frontend/src/pages/query/QueryHomePage.tsx`
  - 查询首页，去掉 hero 感，改成旧工作区信息页
- `frontend/src/pages/query/SummaryDownloadPage.tsx`
  - 按旧模板重排为多分区下载页
- `frontend/src/pages/admin/AdminDashboardPage.tsx`
  - 后台入口工作区
- `frontend/src/pages/admin/AdminResourcePage.tsx`
  - 若仍有新 UI 痕迹，做最小容器调整
- `frontend/src/styles/legacy-ui.css`
  - 本次旧版 UI 抽取和适配样式
- `frontend/src/App.smoke.test.tsx`
  - 烟雾测试，覆盖关键路由和基础旧版容器

**检查文件**

- `templates/base.html`
- `templates/partials/app_nav.html`
- `templates/manager_query.html`
- `templates/summary_download.html`
- `templates/admin/dashboard.html`
- `static/css/style.css`
- `static/js/app_tabs.js`

**验证文件**

- `frontend/package.json`
- `frontend/vite.config.ts`

---

### Task 1: 先补前端烟雾测试，锁住旧版壳层关键结构

**Files:**
- Modify: `frontend/src/App.smoke.test.tsx`
- Check: `frontend/src/router/index.tsx`
- Check: `frontend/src/layouts/AppShell.tsx`

- [ ] **Step 1: 先看现有 smoke test 已覆盖哪些路由**

Run: `sed -n '1,240p' frontend/src/App.smoke.test.tsx`
Expected: 能看到当前测试是否已经渲染登录页、查询页或后台页外壳

- [ ] **Step 2: 新增针对查询页和后台页旧版壳层的失败断言**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./api/auth", () => ({
  fetchSession: vi.fn().mockResolvedValue({
    authenticated: true,
    user: { id: 1, username: "admin", role: "admin" },
  }),
}));

vi.mock("./api/query", () => ({
  fetchNavigation: vi.fn().mockResolvedValue({
    modules: [
      {
        key: "query",
        label: "查询中心",
        home_href: "/query",
        entries: [{ key: "summary-download", label: "汇总下载", href: "/query/summary-download" }],
      },
    ],
  }),
}));

it("renders legacy shell navigation for authenticated routes", async () => {
  render(<App />);
  expect(await screen.findByText("查询中心")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "退出登录" })).toBeInTheDocument();
});
```

- [ ] **Step 3: 运行测试，确认新断言先失败或暴露缺口**

Run: `npm test -- --run frontend/src/App.smoke.test.tsx`
Workdir: `frontend`
Expected: FAIL，提示缺少旧版壳层文案、按钮或测试 mock 不匹配当前结构

- [ ] **Step 4: 根据当前测试工具写法整理最小可维护的 smoke 测试**

```tsx
it("renders legacy shell navigation for authenticated routes", async () => {
  render(<App />);
  expect(await screen.findByText("查询中心")).toBeInTheDocument();
  expect(screen.getByText(/当前用户|admin/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
});
```

- [ ] **Step 5: 再跑一次 smoke test，确认测试基线稳定**

Run: `npm test -- --run frontend/src/App.smoke.test.tsx`
Workdir: `frontend`
Expected: PASS 或只剩下与待实现页面结构直接相关的失败

- [ ] **Step 6: 提交这一小步**

```bash
git add frontend/src/App.smoke.test.tsx
git commit -m "test: cover legacy app shell smoke states"
```

---

### Task 2: 收口公共壳层、导航、页签和状态反馈

**Files:**
- Modify: `frontend/src/layouts/AppShell.tsx`
- Modify: `frontend/src/components/nav/AppMenu.tsx`
- Modify: `frontend/src/components/nav/AppTabs.tsx`
- Modify: `frontend/src/components/feedback/LoadingState.tsx`
- Modify: `frontend/src/components/feedback/ErrorState.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Check: `templates/base.html`
- Check: `templates/partials/app_nav.html`
- Check: `static/js/app_tabs.js`

- [ ] **Step 1: 先确认当前壳层组件里仍保留哪些新布局类名**

Run: `rg -n "app-layout|app-sidebar|top-nav|legacy|panel|shell" frontend/src/layouts/AppShell.tsx frontend/src/components/nav/AppMenu.tsx frontend/src/components/nav/AppTabs.tsx frontend/src/components/feedback`
Expected: 能看到当前新旧类名混用的位置，便于后续替换

- [ ] **Step 2: 给 `AppShell` 调整成旧版结构顺序**

```tsx
return (
  <div className="legacy-app-shell">
    <header className="legacy-topbar">
      <AppMenu
        currentEntry={currentEntry}
        currentModule={currentModule}
        modules={modules}
        mode="top"
      />
      <div className="legacy-topbar-user">
        <span>{user.username}</span>
        <button className="legacy-link-button" onClick={handleLogout} type="button">
          退出登录
        </button>
      </div>
    </header>
    <div className="legacy-workspace">
      <aside className="legacy-sidebar">
        <AppMenu
          currentEntry={currentEntry}
          currentModule={currentModule}
          modules={modules}
          mode="side"
        />
      </aside>
      <section className="legacy-main-area">
        <AppTabs
          currentPath={location.pathname}
          onCloseTab={handleCloseTab}
          onNavigate={handleNavigateTab}
          onRefreshTab={handleRefreshTab}
          tabs={tabs}
        />
        <div className="legacy-main-content">
          {isLoading ? <LoadingState message="正在准备导航..." /> : null}
          {error ? <ErrorState description={error} title="导航加载失败" /> : null}
          {!isLoading && !error ? <Outlet key={`${location.pathname}:${tabReloadKey}`} /> : null}
        </div>
      </section>
    </div>
  </div>
);
```

- [ ] **Step 3: 给 `AppMenu` 区分顶部模块导航和侧栏菜单**

```tsx
interface AppMenuProps {
  currentEntry: QueryNavigationEntry | null;
  currentModule: QueryNavigationModule | null;
  mode: "top" | "side";
  modules: QueryNavigationModule[];
}

if (mode === "top") {
  return (
    <nav className="legacy-module-nav" aria-label="模块导航">
      {modules.map((module) => (
        <button
          key={module.key}
          className={module.key === currentModule?.key ? "legacy-module-link is-active" : "legacy-module-link"}
          onClick={() => navigate(module.home_href)}
          type="button"
        >
          {module.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: 把 `AppTabs` 调整成旧版页签条的最小结构**

```tsx
return (
  <div className="legacy-tabs-bar" role="tablist" aria-label="页面页签">
    {tabs.map((tab) => {
      const active = tab.href === currentPath;
      return (
        <div key={tab.href} className={active ? "legacy-tab is-active" : "legacy-tab"}>
          <button className="legacy-tab-link" onClick={() => onNavigate(tab.href)} type="button">
            {tab.label}
          </button>
          <button className="legacy-tab-action" onClick={() => onRefreshTab(tab.href)} type="button">
            刷新
          </button>
          <button className="legacy-tab-action" onClick={() => onCloseTab(tab.href)} type="button">
            关闭
          </button>
        </div>
      );
    })}
  </div>
);
```

- [ ] **Step 5: 把加载态和错误态改成旧内容区提示块**

```tsx
export default function LoadingState({ message = "正在加载..." }: LoadingStateProps) {
  return (
    <section className="legacy-inline-state" aria-live="polite">
      <p className="legacy-inline-state-title">正在处理</p>
      <p className="legacy-inline-state-body">{message}</p>
    </section>
  );
}
```

```tsx
export default function ErrorState({ description = "请稍后重试。", title = "加载失败" }: ErrorStateProps) {
  return (
    <section className="legacy-inline-state legacy-inline-state-error" role="alert">
      <p className="legacy-inline-state-title">{title}</p>
      <p className="legacy-inline-state-body">{description}</p>
    </section>
  );
}
```

- [ ] **Step 6: 在 `legacy-ui.css` 里补齐壳层、导航、页签和状态块样式**

```css
.legacy-app-shell {
  min-height: 100vh;
  background: #edf1f7;
}

.legacy-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid #c8d4e3;
  background: #f7f9fc;
}

.legacy-workspace {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

.legacy-tabs-bar {
  display: flex;
  gap: 6px;
  padding: 8px 12px 0;
  border-bottom: 1px solid #d4deea;
  background: #f5f8fc;
}

.legacy-inline-state {
  padding: 16px 18px;
  border: 1px solid #d7e0ec;
  background: #ffffff;
}
```

- [ ] **Step 7: 运行 smoke test 和构建，确认公共壳层收口完成**

Run: `npm test -- --run frontend/src/App.smoke.test.tsx`
Workdir: `frontend`
Expected: PASS

Run: `npm run build`
Workdir: `frontend`
Expected: `vite build` 成功

- [ ] **Step 8: 提交这一小步**

```bash
git add frontend/src/layouts/AppShell.tsx frontend/src/components/nav/AppMenu.tsx frontend/src/components/nav/AppTabs.tsx frontend/src/components/feedback/LoadingState.tsx frontend/src/components/feedback/ErrorState.tsx frontend/src/styles/legacy-ui.css
git commit -m "feat: restore legacy app shell and feedback states"
```

---

### Task 3: 收口通用查询页、员工选择器和结果表格

**Files:**
- Modify: `frontend/src/pages/query/QueryPage.tsx`
- Modify: `frontend/src/components/query/EmployeePicker.tsx`
- Modify: `frontend/src/components/query/QueryTable.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Check: `templates/manager_query.html`
- Check: `static/css/style.css`

- [ ] **Step 1: 先定位当前通用查询页里仍偏新的区域**

Run: `sed -n '1,320p' frontend/src/pages/query/QueryPage.tsx`
Expected: 能看到标题区、字段区、选项区、按钮区和结果区的当前 DOM

- [ ] **Step 2: 把 `QueryPage` 调整成旧模板三段结构**

```tsx
return (
  <section className="legacy-page-section">
    <header className="legacy-page-header">
      <div>
        <p className="legacy-page-kicker">查询中心</p>
        <h2 className="legacy-page-title">{title}</h2>
        <p className="legacy-page-description">{description}</p>
      </div>
      <div className="legacy-page-side-info">
        <span>账套：{selectedMonth || "未选择"}</span>
        <span>状态：{isQuerying ? "查询中" : metaText}</span>
      </div>
    </header>

    <section className="legacy-filter-panel">
      <div className="legacy-filter-panel-head">
        <h3>查询条件</h3>
        <p>按当前筛选条件生成结果。</p>
      </div>
      <div className="legacy-form-grid">{/* 字段区 */}</div>
      {options.length ? <div className="legacy-options-row">{/* 勾选项区 */}</div> : null}
      <div className="legacy-filter-actions">{/* 操作按钮区 */}</div>
    </section>

    <section className="legacy-result-panel">
      <div className="legacy-result-panel-head">
        <div>
          <h3>查询结果</h3>
          <p>{metaText}</p>
        </div>
      </div>
      <QueryTable headers={tableHeaders} rows={tableRows} />
    </section>
  </section>
);
```

- [ ] **Step 3: 把 `EmployeePicker` 改成更接近旧版选择器的字段结构**

```tsx
return (
  <div className="legacy-field">
    <span className="legacy-field-label">{label}</span>
    <div className="legacy-employee-picker">
      <input
        className="legacy-input"
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={placeholder}
        value={keyword}
      />
      <button className="legacy-picker-button" onClick={toggleExpanded} type="button">
        选择
      </button>
    </div>
  </div>
);
```

- [ ] **Step 4: 把 `QueryTable` 调整成旧版结果表格外壳**

```tsx
return (
  <div className="legacy-table-wrap">
    <table className="legacy-table">
      <thead>
        <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell ?? "-"}</td>)}
            </tr>
          ))
        ) : (
          <tr>
            <td className="legacy-table-empty" colSpan={Math.max(headers.length, 1)}>
              当前暂无数据
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
```

- [ ] **Step 5: 在 `legacy-ui.css` 里补筛选区、结果区和表格样式**

```css
.legacy-filter-panel,
.legacy-result-panel {
  border: 1px solid #d5deea;
  background: #ffffff;
}

.legacy-filter-panel-head,
.legacy-result-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #e1e7f0;
  background: #f8fafc;
}

.legacy-table {
  width: 100%;
  border-collapse: collapse;
}

.legacy-table th,
.legacy-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f1;
  text-align: left;
}
```

- [ ] **Step 6: 跑查询页相关 smoke test 或构建，确认公共查询页可用**

Run: `npm run build`
Workdir: `frontend`
Expected: 构建成功，没有 `QueryPage`、`EmployeePicker`、`QueryTable` 类型错误

- [ ] **Step 7: 提交这一小步**

```bash
git add frontend/src/pages/query/QueryPage.tsx frontend/src/components/query/EmployeePicker.tsx frontend/src/components/query/QueryTable.tsx frontend/src/styles/legacy-ui.css
git commit -m "feat: align shared query pages with legacy layout"
```

---

### Task 4: 单独还原查询首页和汇总下载页

**Files:**
- Modify: `frontend/src/pages/query/QueryHomePage.tsx`
- Modify: `frontend/src/pages/query/SummaryDownloadPage.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Check: `templates/summary_download.html`

- [ ] **Step 1: 先确认查询首页和汇总下载页当前结构**

Run: `sed -n '1,260p' frontend/src/pages/query/QueryHomePage.tsx`
Expected: 能看到 hero 区和指标区结构

Run: `sed -n '1,320p' frontend/src/pages/query/SummaryDownloadPage.tsx`
Expected: 能看到当前下载条件区、自定义表头区和说明区结构

- [ ] **Step 2: 把 `QueryHomePage` 改成普通工作区信息页**

```tsx
return (
  <section className="legacy-page-section">
    <header className="legacy-page-header">{/* 标题和账套选择 */}</header>
    {!isLoading && !error ? (
      <div className="legacy-home-grid">
        <section className="legacy-info-panel">
          <h3>当前管理人员</h3>
          <p className="legacy-info-primary">{managerLabel || "未绑定管理人员"}</p>
          <p className="legacy-info-secondary">{message}</p>
        </section>
        <section className="legacy-stat-panel">
          {Object.entries(summary ?? {}).map(([key, value]) => (
            <article key={key} className="legacy-stat-row">
              <span>{formatMetricLabel(key)}</span>
              <strong>{value ?? "-"}</strong>
            </article>
          ))}
        </section>
      </div>
    ) : null}
  </section>
);
```

- [ ] **Step 3: 按旧模板多分区重排 `SummaryDownloadPage`**

```tsx
return (
  <section className="legacy-page-section">
    <header className="legacy-page-header">{/* 标题 */}</header>
    <section className="legacy-filter-panel">{/* 下载条件区 */}</section>
    <section className="legacy-download-card-grid">{/* 报表说明区 */}</section>
    <section className="legacy-stat-strip">{/* 指标区 */}</section>
    <section className="legacy-result-panel">{/* 自定义表头区 */}</section>
    <section className="legacy-info-panel">{/* 下载说明区 */}</section>
  </section>
);
```

- [ ] **Step 4: 在 `legacy-ui.css` 里补首页信息块、下载页分区和说明块样式**

```css
.legacy-home-grid {
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
  gap: 16px;
}

.legacy-download-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.legacy-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #e7edf5;
}
```

- [ ] **Step 5: 运行构建，确认重点查询页没有类型或样式引用错误**

Run: `npm run build`
Workdir: `frontend`
Expected: 构建成功

- [ ] **Step 6: 提交这一小步**

```bash
git add frontend/src/pages/query/QueryHomePage.tsx frontend/src/pages/query/SummaryDownloadPage.tsx frontend/src/styles/legacy-ui.css
git commit -m "feat: restore legacy query home and download pages"
```

---

### Task 5: 单独还原后台首页并清理后台资源页残留新样式

**Files:**
- Modify: `frontend/src/pages/admin/AdminDashboardPage.tsx`
- Modify: `frontend/src/pages/admin/AdminResourcePage.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Check: `templates/admin/dashboard.html`

- [ ] **Step 1: 先看后台首页和资源页当前结构**

Run: `sed -n '1,240p' frontend/src/pages/admin/AdminDashboardPage.tsx`
Expected: 能看到当前只有摘要卡片的轻量结构

Run: `sed -n '1,260p' frontend/src/pages/admin/AdminResourcePage.tsx`
Expected: 能看到当前资源页是否仍使用偏新式内容面板

- [ ] **Step 2: 把 `AdminDashboardPage` 改成旧后台入口工作区**

```tsx
return (
  <section className="legacy-page-section">
    <header className="legacy-page-header">
      <div>
        <p className="legacy-page-kicker">后台管理</p>
        <h2 className="legacy-page-title">账套与主数据入口</h2>
        <p className="legacy-page-description">维护账套、部门、班次及相关后台资源。</p>
      </div>
    </header>
    <div className="legacy-admin-grid">
      <section className="legacy-info-panel">
        <h3>当前概况</h3>
        <div className="legacy-stat-row"><span>部门数量</span><strong>{departmentCount}</strong></div>
        <div className="legacy-stat-row"><span>班次数量</span><strong>{shiftCount}</strong></div>
      </section>
      <section className="legacy-result-panel">
        <div className="legacy-result-panel-head">
          <div>
            <h3>管理入口说明</h3>
            <p>从左侧菜单进入对应后台资源页继续维护。</p>
          </div>
        </div>
      </section>
    </div>
  </section>
);
```

- [ ] **Step 3: 对 `AdminResourcePage` 做最小容器修正**

```tsx
return (
  <section className="legacy-page-section">
    <header className="legacy-page-header">{/* 标题区 */}</header>
    <section className="legacy-result-panel">
      <div className="legacy-result-panel-head">
        <div>
          <h3>{resourceTitle}</h3>
          <p>{resourceDescription}</p>
        </div>
      </div>
      <div className="legacy-resource-body">{children}</div>
    </section>
  </section>
);
```

- [ ] **Step 4: 在 `legacy-ui.css` 里补后台入口工作区和资源页样式**

```css
.legacy-admin-grid {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 16px;
}

.legacy-resource-body {
  padding: 16px;
  background: #ffffff;
}
```

- [ ] **Step 5: 跑构建并确认后台页 smoke 路由不报错**

Run: `npm run build`
Workdir: `frontend`
Expected: 构建成功

- [ ] **Step 6: 提交这一小步**

```bash
git add frontend/src/pages/admin/AdminDashboardPage.tsx frontend/src/pages/admin/AdminResourcePage.tsx frontend/src/styles/legacy-ui.css
git commit -m "feat: restore legacy admin workspace pages"
```

---

### Task 6: 总体验证并补最小回归测试

**Files:**
- Modify: `frontend/src/App.smoke.test.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Check: `frontend/src/pages/query/*.tsx`
- Check: `frontend/src/pages/admin/*.tsx`

- [ ] **Step 1: 检查所有查询页和后台页是否还有明显 hero、gradient 或展示型卡片类名**

Run: `rg -n "hero|gradient|metric-card|brand-panel|surface" frontend/src/pages/query frontend/src/pages/admin frontend/src/components`
Expected: 结果只剩登录页或确有必要保留的旧版样式类名，不再有明显新首页表达

- [ ] **Step 2: 按最终结构补一个覆盖查询页和后台页的烟雾测试断言**

```tsx
it("renders legacy query and admin page containers", async () => {
  render(<App />);
  expect(await screen.findByText("查询中心")).toBeInTheDocument();
  expect(screen.getByText(/账套|状态/)).toBeInTheDocument();
});
```

- [ ] **Step 3: 跑前端测试**

Run: `npm test -- --run`
Workdir: `frontend`
Expected: PASS，或只存在与当前仓库已有不稳定测试无关的已知问题

- [ ] **Step 4: 跑前端构建**

Run: `npm run build`
Workdir: `frontend`
Expected: `vite build` 成功

- [ ] **Step 5: 手工验证关键页面**

Run: `npm run dev -- --host 127.0.0.1 --port 4173`
Workdir: `frontend`
Expected: 本地开发服务启动，可手工检查：

- `/login`
- `/query`
- `/query/summary-download`
- `/admin`

- [ ] **Step 6: 提交最终 UI 还原结果**

```bash
git add frontend/src
git commit -m "feat: continue restoring legacy frontend ui"
```

---

## Self-Review

- **Spec coverage:** 已覆盖公共层统一、查询页公共骨架、`QueryHomePage`、`SummaryDownloadPage`、`AdminDashboardPage`、后台资源页最小修正、统一状态反馈和总体验证。
- **Placeholder scan:** 已去除 `TODO`/`TBD`/“后续再补”式占位，所有任务都给出文件、命令和期望结果。
- **Type consistency:** 计划里统一使用 `tabs`、`currentPath`、`onCloseTab`、`onRefreshTab`、`legacy-*` 容器命名，没有混入另一套未定义接口。

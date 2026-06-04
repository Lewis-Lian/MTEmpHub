import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceRoot = resolve(__dirname, "../src");
const mainTsx = readSource("main.tsx");
const legacyCss = readCss("styles/legacy-ui.css");
const appTabsCss = readCss("styles/components/app-tabs.css");
const employeePickerCss = readCss("styles/components/employee-picker.css");
const queryTableCss = readCss("styles/components/query-table.css");
const employeeDashboardCss = readCss("pages/query/EmployeeDashboardPage.css");
const queryHomeCss = readCss("pages/query/QueryHome.css");

function readCss(relativePath: string) {
  return readSource(relativePath);
}

function readSource(relativePath: string) {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}

function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function countExactRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(css.matchAll(new RegExp(`(^|})\\s*${escapedSelector}\\s*\\{`, "g"))).length;
}

describe("style boundaries", () => {
  it("员工查询页样式不会裸覆盖通用查询页面和全局弹窗", () => {
    const css = stripComments(employeeDashboardCss);

    expect(css).not.toMatch(/(^|\})\s*\.query-page-shell\s*\{/);
    expect(css).not.toMatch(/(^|\})\s*\.query-filter-rail\s*\{/);
    expect(css).not.toMatch(/(^|\})\s*\.qh-glow-sphere/);
    expect(css).not.toMatch(/(^|\})\s*\.master-modal/);
    expect(css).not.toMatch(/(^|\})\s*\.employee-picker-modal\s*\{/);
    expect(css).not.toContain("9999");
    expect(css).not.toContain("!important");
  });

  it("全局层级使用 token 承载关键覆盖关系", () => {
    const css = stripComments(legacyCss);

    expect(legacyCss).toContain("--z-sticky");
    expect(legacyCss).toContain("--z-dropdown");
    expect(legacyCss).toContain("--z-modal");
    expect(legacyCss).toContain("--z-overlay");
    expect(legacyCss).toContain("z-index: var(--z-sticky)");
    expect(legacyCss).toContain("z-index: var(--z-dropdown)");
    expect(legacyCss).toContain("z-index: var(--z-modal)");
    expect(css).not.toMatch(/z-index\s*:\s*[1-9]\d{3,}/);
  });

  it("首页主体容器不隐藏长内容溢出", () => {
    const css = stripComments(queryHomeCss);
    const containerRule = css.match(/\.query-home-container\s*\{[^}]*\}/)?.[0] ?? "";

    expect(containerRule).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it("核心全局组件样式在所属组件文件中不重复定义 exact selector", () => {
    const appTabs = stripComments(appTabsCss);
    const employeePicker = stripComments(employeePickerCss);
    const queryTable = stripComments(queryTableCss);

    expect(employeePicker).not.toContain("!important");
    expect(countExactRule(appTabs, ".app-tab-bar")).toBe(1);
    expect(countExactRule(appTabs, ".app-tab-list")).toBe(1);
    expect(countExactRule(appTabs, ".app-tab-button")).toBe(1);
    expect(countExactRule(employeePicker, ".employee-picker-modal")).toBe(1);
    expect(countExactRule(employeePicker, ".employee-picker-modal .modal-content")).toBe(1);
    expect(countExactRule(queryTable, ".table-pager")).toBe(1);
  });

  it("页签、员工选择弹窗、查询表格分页器样式从 legacy-ui 拆出", () => {
    const legacy = stripComments(legacyCss);

    expect(mainTsx).toContain("./styles/components/app-tabs.css");
    expect(mainTsx).toContain("./styles/components/employee-picker.css");
    expect(mainTsx).toContain("./styles/components/query-table.css");
    expect(appTabsCss).toContain(".app-tab-bar");
    expect(employeePickerCss).toContain(".employee-picker-modal");
    expect(queryTableCss).toContain(".table-pager");
    expect(legacy).not.toMatch(/\.app-tab-(?:bar|list|button|close|refresh)\b/);
    expect(legacy).not.toContain(".employee-picker-modal");
    expect(countExactRule(legacy, ".app-tab-bar")).toBe(0);
    expect(countExactRule(legacy, ".employee-picker-modal")).toBe(0);
    expect(countExactRule(legacy, ".table-pager")).toBe(0);
  });

  it("通用查询布局 exact selector 在 legacy-ui 中只保留一份基础定义", () => {
    const legacy = stripComments(legacyCss);

    expect(countExactRule(legacy, ".query-page-shell")).toBe(1);
    expect(countExactRule(legacy, ".query-filter-rail")).toBe(1);
    expect(countExactRule(legacy, ".query-workspace")).toBe(1);
  });
});

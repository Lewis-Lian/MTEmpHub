import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// 色板无损替换白名单：属性路由 × 值与 token 完全相等 × 语义匹配。
// 排除的语义特例：color/border 下的 #ffffff（反白文字/白描边，无对应语义 token）。
const ENT_FILES = [
  "styles/legacy-ui.css",
  "styles/admin-ui.css",
  "styles/components/app-tabs.css",
  "styles/components/employee-picker.css",
  "styles/components/query-table.css",
  "styles/components/notification.css",
  "styles/components/confirm-dialog.css",
  "styles/components/slider-captcha.css",
  "styles/components/attendance-calendar.css",
];
const QH_FILES = ["pages/query/QueryHome.css", "pages/query/dashboard-shared.css"];

const BG = ["background", "background-color"];
const BORDER = ["border", "border-top", "border-bottom", "border-left", "border-right", "border-color"];

function norm(hex: string) {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

function buildRoutes(): Map<string, string> {
  // key: `${文件}|${属性}|${hex归一化}` -> token
  const routes = new Map<string, string>();
  const add = (files: string[], props: string[], pairs: Record<string, string>) => {
    for (const f of files) for (const p of props) {
      for (const [hex, token] of Object.entries(pairs)) routes.set(`${f}|${p}|${norm(hex)}`, token);
    }
  };
  add(ENT_FILES, BG, {
    "#ffffff": "--ent-bg", "#fff": "--ent-bg",
    "#f8fafc": "--ent-secondary-bg", "#f1f5f9": "--ent-tertiary-bg",
  });
  add(ENT_FILES, BORDER, {
    "#f1f5f9": "--ent-border", "#e2e8f0": "--ent-border-strong", "#3b82f6": "--ent-border-focus",
  });
  add(ENT_FILES, ["color"], {
    "#0f172a": "--ent-text", "#64748b": "--ent-text-secondary", "#94a3b8": "--ent-text-tertiary",
    "#2563eb": "--ent-blue", "#1d4ed8": "--ent-blue-hover",
  });
  add(QH_FILES, BG, {
    "#f8fafc": "--qh-bg-page", "#0284c7": "--qh-primary", "#059669": "--qh-success",
    "#d97706": "--qh-warning", "#7c3aed": "--qh-purple", "#dc2626": "--qh-danger", "#2563eb": "--qh-info",
  });
  add(QH_FILES, ["color"], {
    "#0f172a": "--qh-text-main", "#64748b": "--qh-text-muted", "#0284c7": "--qh-primary",
    "#059669": "--qh-success", "#d97706": "--qh-warning", "#dc2626": "--qh-danger",
  });
  add(QH_FILES, BORDER, { "#0284c7": "--qh-primary" });
  return routes;
}

describe("色板 token 化", () => {
  it("白名单内（属性路由+值相等+语义匹配）的 hex 必须引用 token", () => {
    const routes = buildRoutes();
    const violations: string[] = [];
    for (const [key, token] of routes) {
      const [rel, prop, hex] = key.split("|");
      const text = readFileSync(join(srcRoot, rel), "utf8");
      text.split("\n").forEach((line, idx) => {
        const m = line.match(new RegExp(`^\\s*${prop}\\s*:`));
        if (!m) return;
        const re = new RegExp(`${hex.replace("#", "#")}(?![0-9a-fA-F])`, "i");
        if (re.test(line) && !line.includes(`var(${token}`)) {
          violations.push(`${rel}:${idx + 1} ${prop} 裸 ${hex} 应为 var(${token})`);
        }
      });
    }
    expect(violations.slice(0, 30)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});

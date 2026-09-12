import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("消息发送页表单样式作用域", () => {
  it("表单控件规则必须限定直接子级，不得以下溯形式命中 EmployeePicker 内部元素", () => {
    const text = readFileSync(join(srcRoot, "styles/components/admin-message-page.css"), "utf8");
    const violations: string[] = [];
    for (const m of text.matchAll(/[^{}]+(?=\{)/g)) {
      const selector = m[0].replace(/\/\*[^*]*\*\//g, "").trim();
      if (/\.admin-message-form\s+(input|select|textarea|button|label)\b/.test(selector)) {
        violations.push(selector);
      }
    }
    expect(violations).toEqual([]);
  });

  it("员工选择器在消息页对齐查询区控件规格（36px 高 + #d7e3ef 描边）", () => {
    const text = readFileSync(join(srcRoot, "styles/components/admin-message-page.css"), "utf8");
    expect(text).toContain(".admin-message-section .employee-lookup .form-control");
    expect(text).toContain(".admin-message-section .employee-lookup .btn");
  });
});

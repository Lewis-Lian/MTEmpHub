import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function findCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...findCssFiles(full));
    } else if (name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

describe("z-index 分层规范", () => {
  it("z-index >= 30 的声明必须引用 --z-* token（局部小层级 <30 不受限）", () => {
    const violations: string[] = [];
    for (const file of findCssFiles(srcRoot)) {
      const rel = file.replace(srcRoot + "/", "");
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, idx) => {
        const m = line.match(/z-index:\s*([^;]+);/);
        if (!m) return;
        const value = m[1].trim();
        const num = Number(value);
        if (!Number.isNaN(num) && num >= 30) {
          violations.push(`${rel}:${idx + 1} 裸数值 ${value}`);
        } else if (value.startsWith("var(") && !value.startsWith("var(--z-")) {
          violations.push(`${rel}:${idx + 1} 非 --z-* token: ${value}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});

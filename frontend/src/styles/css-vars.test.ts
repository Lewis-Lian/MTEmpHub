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

interface VarUsage {
  file: string;
  line: number;
  name: string;
}

describe("CSS 变量一致性", () => {
  it("所有 var(--x) 引用（无 fallback 的）都有对应定义", () => {
    const cssFiles = findCssFiles(srcRoot);
    expect(cssFiles.length).toBeGreaterThan(0);

    const defined = new Set<string>();
    const usages: VarUsage[] = [];

    for (const file of cssFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        defined.add(m[1]);
      }
      // 只检查无 fallback 的引用：var(--x) 结尾而非 var(--x, ...)
      for (const m of text.matchAll(/var\((--[a-zA-Z0-9-]+)\s*\)/g)) {
        const line = text.slice(0, m.index ?? 0).split("\n").length;
        usages.push({ file: file.replace(srcRoot + "/", ""), line, name: m[1] });
      }
    }

    const broken = usages.filter((u) => !defined.has(u.name));
    expect(
      broken.map((u) => `${u.file}:${u.line} ${u.name}`),
    ).toEqual([]);
  });
});

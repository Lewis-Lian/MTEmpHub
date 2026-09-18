import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(fileURLToPath(import.meta.url));

describe("通知卡片视觉样式", () => {
  it("使用统一卡片底色与玻璃质感，不依赖左侧状态线", () => {
    const css = readFileSync(join(srcRoot, "components/notification.css"), "utf8");
    const baseRule = css.match(/\.notification-item\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(baseRule).toContain("background: rgba(255, 255, 255, 0.88)");
    expect(baseRule).toContain("backdrop-filter: blur(18px)");
    expect(baseRule).toContain("border-radius: 14px");
    expect(baseRule).not.toContain("border-left");
  });
});

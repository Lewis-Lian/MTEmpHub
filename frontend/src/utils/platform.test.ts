import { describe, expect, it, vi } from "vitest";
import { getSearchShortcutKey, isMacPlatform } from "./platform";

describe("platform utils", () => {
  it("识别 Mac 平台并返回 ⌘+K", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(isMacPlatform()).toBe(true);
    expect(getSearchShortcutKey()).toBe("⌘+K");

    vi.unstubAllGlobals();
  });

  it("识别 Windows 平台并返回 Ctrl+K", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    expect(isMacPlatform()).toBe(false);
    expect(getSearchShortcutKey()).toBe("Ctrl+K");

    vi.unstubAllGlobals();
  });
});

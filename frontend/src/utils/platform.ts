/**
 * 平台环境检测工具
 */

export function isMacPlatform(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const nav = window.navigator as unknown as {
    userAgentData?: { platform?: string };
    platform?: string;
    userAgent?: string;
  };
  const platform = (nav.userAgentData?.platform || nav.platform || "").toLowerCase();
  const ua = (nav.userAgent || "").toLowerCase();
  return platform.includes("mac") || ua.includes("macintosh") || ua.includes("mac os x");
}

export function getSearchShortcutKey(): string {
  return isMacPlatform() ? "⌘+K" : "Ctrl+K";
}

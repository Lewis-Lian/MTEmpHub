export type ThemeMode = "auto" | "light" | "dark";

const THEME_STORAGE_KEY = "mtemphub-theme-mode";

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }
  return "auto";
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): "light" | "dark" {
  const resolved = mode === "auto" ? getSystemTheme() : mode;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-mode", mode);
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function setStoredThemeMode(mode: ThemeMode): "light" | "dark" {
  if (typeof window !== "undefined") {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  }
  return applyTheme(mode);
}

export function initTheme(): void {
  const mode = getStoredThemeMode();
  applyTheme(mode);
}

import { afterEach, describe, expect, it, vi } from "vitest";

describe("manager attendance CSV URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("includes the configured API base URL", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.resetModules();
    const { managerAttendanceUnmatchedCsvUrl } = await import("./admin");
    expect(managerAttendanceUnmatchedCsvUrl(42)).toBe("https://api.example.test/api/admin/manager-attendance/sync-runs/42/unmatched.csv");
  });
});

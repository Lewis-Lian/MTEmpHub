import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBootstrap = vi.hoisted(() => vi.fn());
const mockFetchMe = vi.hoisted(() => vi.fn());
const mockHomeSummary = vi.hoisted(() => vi.fn());

vi.mock("../../api/query", () => ({
  fetchQueryBootstrap: mockBootstrap,
  fetchHomeSummary: mockHomeSummary,
}));
vi.mock("../../api/auth", () => ({
  fetchMe: mockFetchMe,
}));

import QueryHomePage from "./QueryHomePage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QueryHomePage 纯首页权限用户", () => {
  beforeEach(() => {
    mockFetchMe.mockResolvedValue({ username: "100701010", role: "readonly" });
    // 纯首页权限用户也能拿到账套（首页摘要依赖它定位数据），但 departments 为空
    mockBootstrap.mockResolvedValue({
      employees: [],
      account_sets: [
        { id: 1, month: "2026-05", name: "2026年5月", is_active: true },
      ],
      departments: [],
    });
    mockHomeSummary.mockResolvedValue({
      has_data: true,
      month: "2026-05",
      account_set_name: "2026年5月",
      support_message: "已加载首页摘要",
      manager: { emp_no: "100701010", name: "余兆中", dept_name: "制造一部" },
      summary: { attendance_days: 20 },
    });
  });

  it("能拿到账套并加载出绑定的管理人员摘要", async () => {
    render(<QueryHomePage />);

    // 应调用 home-summary（month 来自账套）并显示真实摘要，而非卡在 loading
    await waitFor(
      () => {
        expect(mockHomeSummary).toHaveBeenCalledWith("2026-05");
      },
      { timeout: 2000 },
    );

    // 不应停留在加载文案
    await waitFor(() => {
      expect(screen.queryByText("正在加载首页摘要...")).toBeNull();
    });
  });
});

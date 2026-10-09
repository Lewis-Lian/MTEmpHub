import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearQueryBootstrapCache, fetchQueryBootstrap } from "../api/query";
import type { QueryBootstrap } from "../types/query";
import { useMonthQueryBootstrap } from "./useMonthQueryBootstrap";

beforeEach(() => {
  clearQueryBootstrapCache();
  vi.stubGlobal("fetch", async (url: string) => {
    const month = new URL(String(url), "http://localhost").searchParams.get("month");
    return new Response(JSON.stringify({ employees: [{ id: 1, emp_no: "E1", name: month === "2026-07" ? "七月甲" : "六月甲" }], departments: [], account_sets: [] }), { headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearQueryBootstrapCache(); });

it("月份分别请求并缓存，不能复用其他月份的候选资料", async () => {
  expect((await fetchQueryBootstrap("2026-06")).employees[0].name).toBe("六月甲");
  expect((await fetchQueryBootstrap("2026-07")).employees[0].name).toBe("七月甲");
});

function MonthCandidates({ month }: { month: string }) {
  const [bootstrap, setBootstrap] = useState<QueryBootstrap | null>(null);
  useMonthQueryBootstrap(month, setBootstrap);
  return <output>{bootstrap?.employees[0]?.name}</output>;
}
it("切换月份时刷新候选资料", async () => {
  const { rerender } = render(<MonthCandidates month="2026-06" />);
  await waitFor(() => expect(screen.getByText("六月甲")).toBeInTheDocument());
  rerender(<MonthCandidates month="2026-07" />);
  await waitFor(() => expect(screen.getByText("七月甲")).toBeInTheDocument());
});

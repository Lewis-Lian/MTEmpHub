import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MealLedgerPage from "./MealLedgerPage";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));

beforeEach(() => {
  request.mockReset();
  // HTTP 页面可用 getRandomValues，但没有 randomUUID。
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["card", "paper"])("HTTP 下外来 %s 领用可保存，失败重试复用标识，后续登记生成新标识", async category => {
  const submitted: Array<Record<string, unknown>> = [];
  let rows: object[] = [];
  request.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
    if (path === "/api/admin/departments") return Promise.resolve([
      { id: 1, dept_no: "D01", dept_name: "接待部", parent_id: null },
    ]);
    if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([]);
    if (path === "/api/meal-ledgers/external" && options?.method === "POST") {
      submitted.push(options.body!);
      if (submitted.length === 1) return Promise.reject(new Error("网络中断，请重试"));
      const record = { id: submitted.length, ...options.body, amount: 20, voided: false };
      rows = [...rows, record];
      return Promise.resolve(record);
    }
    return Promise.resolve(rows);
  });

  render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
  await screen.findByRole("button", { name: "保存记录" });
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "访客甲" } });
  fireEvent.change(screen.getByLabelText("承担费用的部门"), { target: { value: "接待部" } });
  fireEvent.change(screen.getByLabelText("类别"), { target: { value: category } });
  fireEvent.change(screen.getByLabelText("发放金额"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("网络中断，请重试"));

  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await screen.findByText("记录已保存");
  expect(screen.getByText("访客甲")).toBeInTheDocument();
  expect(submitted).toHaveLength(2);
  expect(submitted[0].request_key).toMatch(/^[0-9a-f]{32}$/);
  expect(submitted[1]).toEqual(submitted[0]);

  fireEvent.click(screen.getByRole("button", { name: "继续登记领用" }));
  await screen.findByRole("button", { name: "保存记录" });
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "访客甲" } });
  fireEvent.change(screen.getByLabelText("发放金额"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await waitFor(() => expect(submitted).toHaveLength(3));
  await screen.findByText("记录已保存");
  expect(submitted[2].request_key).toMatch(/^[0-9a-f]{32}$/);
  expect(submitted[2].request_key).not.toBe(submitted[0].request_key);
});

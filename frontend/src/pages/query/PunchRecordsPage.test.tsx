import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/feedback/ConfirmDialog";
import PunchRecordsPage from "./PunchRecordsPage";
import * as queryApi from "../../api/query";
import { clearQueryBootstrapCache } from "../../api/query";

beforeEach(() => {
  clearQueryBootstrapCache();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (String(input).includes("bootstrap")) return new Response(JSON.stringify({
      employees: [], departments: [],
      account_sets: [{ id: 1, month: "2026-05", name: "五月", is_active: true }, { id: 2, month: "2026-02", name: "二月", is_active: false }],
    }), { headers: { "Content-Type": "application/json" } });
    const query = new URL(String(input), "http://localhost").searchParams;
    return new Response(JSON.stringify([{ date: query.get("start_date"), name: query.get("end_date") }]), { headers: { "Content-Type": "application/json" } });
  }));
});

it("defaults to the whole month and sends the selected date range", async () => {
  render(<ConfirmProvider><PunchRecordsPage /></ConfirmProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "更多筛选" }));
  const start = await screen.findByLabelText("开始日期");
  const end = screen.getByLabelText("结束日期");
  await waitFor(() => expect(start).toHaveValue("2026-05-01"));
  expect(end).toHaveValue("2026-05-31");
  fireEvent.change(start, { target: { value: "2026-05-10" } });
  fireEvent.change(end, { target: { value: "2026-05-11" } });
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  expect(await screen.findByText("2026-05-10")).toBeInTheDocument();
  expect(screen.getByText("2026-05-11")).toBeInTheDocument();
});

it("blocks reversed and missing dates for querying and downloading", async () => {
  render(<ConfirmProvider><PunchRecordsPage /></ConfirmProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "更多筛选" }));
  const start = await screen.findByLabelText("开始日期");
  await waitFor(() => expect(start).toHaveValue("2026-05-01"));
  fireEvent.change(start, { target: { value: "2026-05-31" } });
  fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-05-01" } });
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  expect(await screen.findByText("开始日期不能晚于结束日期")).toBeInTheDocument();
  fireEvent.change(start, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "下载XLSX" }));
  expect(await screen.findByText("请选择开始日期和结束日期")).toBeInTheDocument();
});

it("resets dates to the newly selected account month", async () => {
  render(<ConfirmProvider><PunchRecordsPage /></ConfirmProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "更多筛选" }));
  const start = await screen.findByLabelText("开始日期");
  await waitFor(() => expect(start).toHaveValue("2026-05-01"));
  fireEvent.change(start, { target: { value: "2026-05-10" } });
  fireEvent.click(screen.getByRole("combobox", { name: "账套选择：五月" }));
  fireEvent.click(screen.getByRole("option", { name: /二月/ }));
  expect(start).toHaveValue("2026-02-01");
  expect(screen.getByLabelText("结束日期")).toHaveValue("2026-02-28");
});

it("includes the same selected date range in the download URL", async () => {
  const download = vi.spyOn(queryApi, "buildDownloadUrl").mockReturnValue("#download");
  render(<ConfirmProvider><PunchRecordsPage /></ConfirmProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "更多筛选" }));
  const start = await screen.findByLabelText("开始日期");
  await waitFor(() => expect(start).toHaveValue("2026-05-01"));
  fireEvent.change(start, { target: { value: "2026-05-10" } });
  fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-05-11" } });
  fireEvent.click(screen.getByRole("button", { name: "下载XLSX" }));
  expect(download).toHaveBeenCalledWith("/api/query/punch-records/export", expect.any(URLSearchParams));
  const query = download.mock.calls[0][1];
  expect(query.get("start_date")).toBe("2026-05-10");
  expect(query.get("end_date")).toBe("2026-05-11");
  download.mockRestore();
});

it("starts collapsed and preserves the range when filters are reopened", async () => {
  render(<ConfirmProvider><PunchRecordsPage /></ConfirmProvider>);
  const toggle = await screen.findByRole("button", { name: "更多筛选" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("开始日期")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: /账套选择/ })).not.toBeInTheDocument();
  expect(screen.queryByText("显示选项")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).toBeVisible();
  expect(screen.getByRole("button", { name: "下载XLSX" })).toBeVisible();
  expect(await screen.findByText("2026-05-01 至 2026-05-31")).toBeVisible();
  fireEvent.click(toggle);
  const range = screen.getByRole("group", { name: "日期范围" });
  const start = within(range).getByLabelText("开始日期");
  expect(within(range).getByLabelText("结束日期")).toHaveValue("2026-05-31");
  fireEvent.change(start, { target: { value: "2026-05-10" } });
  fireEvent.click(screen.getByRole("button", { name: "收起筛选" }));
  expect(screen.getByText("2026-05-10 至 2026-05-31")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "更多筛选" }));
  expect(screen.getByLabelText("开始日期")).toHaveValue("2026-05-10");
});

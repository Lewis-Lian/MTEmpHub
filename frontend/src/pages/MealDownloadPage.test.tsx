import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MealDownloadPage from "./MealDownloadPage";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));

describe("菜票批量下载", () => {
  beforeEach(() => {
    request.mockResolvedValue({ role: "readonly", page_permissions: { meal_ticket_query: true, meal_ledger_query: true } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("可多选月度报表与独立年份的全年汇总，一次下载并防止重复提交", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<MealDownloadPage />);
    const recharge = await screen.findByRole("checkbox", { name: "月度充值记录" });
    fireEvent.change(screen.getByLabelText("充值月份"), { target: { value: "2026-09" } });
    expect(screen.getByText(/考勤.*2026-08/)).toBeInTheDocument();
    fireEvent.click(recharge);
    fireEvent.click(screen.getByRole("checkbox", { name: "部门菜票发放汇总" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "全年菜票汇总" }));
    fireEvent.change(screen.getByLabelText("全年报表年份"), { target: { value: "2025" } });
    fireEvent.click(screen.getByRole("button", { name: "下载已选 3 份报表" }));
    expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0][0] as unknown as string, "http://localhost");
    expect(url.pathname).toBe("/api/meal-ledgers/export-batch");
    expect(url.searchParams.get("reports")).toBe("recharge,department,annual");
    expect(url.searchParams.get("month")).toBe("2026-09");
    expect(url.searchParams.get("year")).toBe("2025");
    finish(new Response(new Blob(["zip"]), { status: 200 }));
    await screen.findByRole("status");
    expect(click).toHaveBeenCalledOnce();
  });

  it("全选、清空和失败重试均保留清晰的选择状态", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "月度充值记录：本月没有核算数据" }),
      { status: 404, headers: { "Content-Type": "application/json" } })));
    render(<MealDownloadPage />);
    await screen.findByRole("checkbox", { name: "月度充值记录" });
    fireEvent.click(screen.getByRole("button", { name: "全选月度报表" }));
    expect(screen.getByRole("button", { name: "下载已选 4 份报表" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect(screen.getByRole("button", { name: "请选择报表" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "月度充值记录" }));
    fireEvent.click(screen.getByRole("button", { name: "下载已选 1 份报表" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("本月没有核算数据"));
    expect(screen.getByRole("checkbox", { name: "月度充值记录" })).toBeChecked();
    expect(screen.getByRole("button", { name: "下载已选 1 份报表" })).toBeEnabled();
  });

  it("调整排版在独立弹窗显示，关闭后返回入口并保留报表选择", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/auth/me" ? { role: "admin" }
      : { left: ["木皮线"], right: ["行政部"], unassigned: [] }));
    render(<MealDownloadPage />);
    const opener = await screen.findByRole("button", { name: "调整排版" });
    fireEvent.click(screen.getByRole("checkbox", { name: "部门菜票发放汇总" }));
    opener.focus(); fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "部门排版设置" });
    expect(await within(dialog).findByRole("table", { name: "左侧部门" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "保存排版" })).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    within(dialog).getByRole("button", { name: "关闭排版设置" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("button", { name: "保存排版" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "关闭排版设置" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(screen.getByRole("checkbox", { name: "部门菜票发放汇总" })).toBeChecked();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "关闭排版设置" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

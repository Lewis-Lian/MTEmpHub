import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MealBatch } from "../api/mealTickets";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
import MealAdjustmentImport from "./MealAdjustmentImport";

const batch = { id: 1, version: 2, recharge_month: "2026-09" } as MealBatch;
const preview = { token: "signed-preview", filename: "补扣.xlsx", recharge_month: "2026-09", total_amount: -16,
  error_count: 0, rows: [{ row: 2, emp_no: "001", name: "员工甲", dept_name: "生产部", amount: -16, reason: "异常天数扣除", error: "" }] };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("/preview") ? preview : { ...batch, version: 3 }));
});
async function upload() {
  fireEvent.click(screen.getByRole("button", { name: "导入补扣清单" }));
  fireEvent.change(screen.getByLabelText("补扣 Excel 文件"), { target: { files: [new File(["data"], "补扣.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "预览导入" }));
  await screen.findByText("异常天数扣除");
}

it("previews an uploaded file and only applies it after confirmation", async () => {
  const onImported = vi.fn();
  render(<MealAdjustmentImport batch={batch} busy={false} onBusyChange={vi.fn()} onImported={onImported} />);
  expect(screen.getByRole("link", { name: "下载补扣模板" })).toHaveAttribute("href", "/api/meal-tickets/adjustment-import/template");
  await upload();
  expect(screen.getByText(/合计调整 -16.00 元/)).toBeInTheDocument();
  expect(onImported).not.toHaveBeenCalled();
  const form = request.mock.calls[0][1].body as FormData;
  expect(form.get("batch_id")).toBe("1");
  expect(form.get("version")).toBe("2");
  expect(form.get("file")).toBeInstanceOf(File);
  fireEvent.click(screen.getByRole("button", { name: "确认导入补扣" }));
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ version: 3 })));
  expect(request).toHaveBeenLastCalledWith("/api/meal-tickets/adjustment-import/confirm",
    { method: "POST", body: { token: "signed-preview" } });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onImported).toHaveBeenCalledTimes(1);
  // 父页用确认返回的新批次版本刷新任务；导入本身只登记调整，不办理资金或进度。
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    "/api/meal-tickets/adjustment-import/preview", "/api/meal-tickets/adjustment-import/confirm",
  ]);
});

it("shows row errors and prevents confirmation", async () => {
  request.mockResolvedValue({ ...preview, error_count: 1, rows: [{ ...preview.rows[0], error: "工号未匹配本月核算人员" }] });
  render(<MealAdjustmentImport batch={batch} busy={false} onBusyChange={vi.fn()} onImported={vi.fn()} />);
  await upload();
  expect(screen.getByText("工号未匹配本月核算人员")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认导入补扣" })).toBeDisabled();
});

it("keeps the preview and reports a failed confirmation", async () => {
  request.mockImplementation((path: string) => path.endsWith("/preview") ? Promise.resolve(preview) : Promise.reject(new Error("数据已变化，请重新预览")));
  render(<MealAdjustmentImport batch={batch} busy={false} onBusyChange={vi.fn()} onImported={vi.fn()} />);
  await upload();
  fireEvent.click(screen.getByRole("button", { name: "确认导入补扣" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("数据已变化，请重新预览");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("discards the preview when the selected file changes", async () => {
  render(<MealAdjustmentImport batch={batch} busy={false} onBusyChange={vi.fn()} onImported={vi.fn()} />);
  await upload();
  fireEvent.change(screen.getByLabelText("补扣 Excel 文件"), { target: { files: [new File(["other"], "第二份.xlsx")] } });
  expect(screen.queryByRole("button", { name: "确认导入补扣" })).toBeNull();
});

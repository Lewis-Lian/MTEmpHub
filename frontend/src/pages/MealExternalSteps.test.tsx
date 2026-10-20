import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import MealLedgerPage from "./MealLedgerPage";
import type { LedgerRecord } from "../api/mealLedgers";
const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
beforeEach(() => { request.mockReset(); });
const card = { key: "guest-1", name: "客人卡01", card_no: "0009001", emp_no: "G001", is_active: true };
function fixture() {
  let records: LedgerRecord[] = [];
  request.mockImplementation(async (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/api/auth/me") return { role: "admin" };
    if (path === "/api/admin/departments") return [{ id: 1, dept_no: "01", dept_name: "接待部", parent_id: null }];
    if (path === "/api/meal-ledgers/guest-cards") return [card];
    if (path === "/api/meal-ledgers/external" && options?.method === "POST") {
      records = [{ ...options.body, id: 1, amount: 100, actual_amount: options.body?.guest_card_key ? 0 : 100,
        recharge_status: options.body?.guest_card_key ? "pending" : "manual", voided: false } as LedgerRecord];
      return records[0];
    }
    if (path.endsWith("/recharge-check")) {
      const confirmed = Array.isArray(options?.body?.source_keys);
      if (confirmed) records = [{ ...records[0], actual_amount: 100, recharge_status: "complete" }];
      return { record: records[0], candidates: [{ source_key: "recharge-1", date: records[0].date + "T10:00:00",
        amount: 100, matched: confirmed, occupied: false }] };
    }
    return records;
  });
  render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
}
async function fill(category: string, linked = false) {
  await screen.findByRole("button", { name: "保存记录" });
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "访客甲" } });
  fireEvent.change(screen.getByLabelText("承担费用的部门"), { target: { value: "接待部" } });
  fireEvent.change(screen.getByLabelText("类别"), { target: { value: category } });
  if (linked) fireEvent.change(screen.getByLabelText("客人卡"), { target: { value: card.key } });
  fireEvent.change(screen.getByLabelText(linked ? "应充值金额" : "发放金额"), { target: { value: "100" } });
}
it("客人卡领用按登记、充值核对、台账顺序显示，未来步骤内容隐藏", async () => {
  fixture(); await fill("card", true);
  expect(screen.queryByRole("heading", { name: "待核对充值" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "领用明细列表" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "记录概览统计" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await screen.findByRole("heading", { name: "待核对充值" });
  expect(screen.queryByRole("button", { name: "保存记录" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "领用明细列表" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "核对充值" }));
  const dialog = within(screen.getByRole("dialog", { name: "客人卡充值核对" }));
  fireEvent.click(dialog.getByRole("button", { name: "查询充值" }));
  fireEvent.click(await dialog.findByLabelText("选择充值 recharge-1"));
  fireEvent.click(dialog.getByRole("button", { name: "确认选中充值" }));
  await waitFor(() => expect(dialog.getByLabelText("实际充值")).toHaveTextContent("100.00"));
  fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "下一步：查看台账" }));
  await screen.findByRole("heading", { name: "领用明细列表" });
  expect(screen.getByRole("region", { name: "记录概览统计" })).toHaveTextContent("100.00");
  expect(screen.queryByRole("heading", { name: "待核对充值" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("textbox", { name: "业务月份" }));
  fireEvent.click(screen.getByRole("button", { name: "7月" }));
  await screen.findByRole("button", { name: "保存记录" });
  expect(screen.queryByRole("heading", { name: "领用明细列表" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("处理日期")).toHaveValue("");
});
it.each(["paper", "card"])("%s 手工领用保存后跳过数据库核对，继续登记保留默认值", async category => {
  fixture(); await fill(category);
  const date = (screen.getByLabelText("处理日期") as HTMLInputElement).value;
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await screen.findByRole("heading", { name: "领用明细列表" });
  expect(screen.queryByRole("heading", { name: "待核对充值" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "核对充值" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续登记领用" }));
  expect(screen.getByLabelText("处理日期")).toHaveValue(date);
  expect(screen.getByLabelText("承担费用的部门")).toHaveValue("接待部");
  expect(screen.getByLabelText("类别")).toHaveValue(category);
  expect(screen.getByLabelText("姓名")).toHaveValue("");
  expect(screen.queryByRole("heading", { name: "领用明细列表" })).not.toBeInTheDocument();
});

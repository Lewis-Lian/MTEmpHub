import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import MealClearanceImport, { type ClearanceStage } from "./MealClearanceImport";
const request = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ apiRequest: request }));
const row = { source_key:"card-meal:db:refund:12", emp_no:"001", name:"员工甲", dept_name:"生产部", card_no:"C001",
  date:"2026-09-30T23:59:00", amount:20, status:"available" };
const preview = {month:"2026-09",start_date:"2026-09-01",end_date:"2026-09-30",source_digest:"source",rows:[row]};
beforeEach(() => { request.mockReset(); });
function Wrapper({ imported = async () => {} }: { imported?: () => Promise<void> }) {
  const [stage, setStage] = useState<ClearanceStage>("query");
  const [busy, setBusy] = useState(false);
  return <><MealClearanceImport month="2026-09" stage={stage} onStageChange={setStage} busy={busy} onBusyChange={setBusy} onImported={imported} />
    {stage === "ledger" && <p>台账内容</p>}</>;
}
it("查询仅预览，勾选确认后自动入账并进入台账，屏蔽已扣回及疑似重复", async () => {
  let refreshed = false;
  request.mockImplementation(async (path: string) => path.endsWith("/preview")
    ? {...preview,rows:[row,{...row,source_key:"refund",name:"已扣回人员",status:"refunded"},
      {...row,source_key:"manual",name:"手工记录人员",status:"manual_conflict"}]}
    : {month:"2026-09",added:1,existing:0});
  render(<Wrapper imported={async () => { refreshed = true; }} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"查询取款流水"}));
  await screen.findByText("员工甲");
  expect(screen.queryByLabelText("查询开始日期")).not.toBeInTheDocument();
  expect(refreshed).toBe(false);
  expect(screen.getByRole("button",{name:"确认清零并入账"})).toBeDisabled();
  const rows = screen.getAllByRole("row");
  expect(within(rows[2]).getByRole("checkbox")).toBeDisabled();
  expect(within(rows[3]).getByRole("checkbox")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("选择清零流水 " + row.source_key));
  fireEvent.click(screen.getByRole("button",{name:"确认清零并入账"}));
  await screen.findByText("台账内容");
  expect(refreshed).toBe(true);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith("/api/meal-ledgers/clearance/confirm",expect.objectContaining({body:{
    month:"2026-09",start_date:"2026-09-01",end_date:"2026-09-30",source_digest:"source",source_keys:[row.source_key]}}));
});
it("查询及确认失败保持当前步骤，重新查询必须重新选择", async () => {
  request.mockRejectedValueOnce(new Error("数据库未启用")).mockResolvedValueOnce(preview)
    .mockRejectedValueOnce(new Error("取款流水已变化"));
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button",{name:"查询取款流水"}));
  await screen.findByText("数据库未启用");
  expect(screen.getByLabelText("查询开始日期")).toHaveValue("2026-09-01");
  fireEvent.click(screen.getByRole("button",{name:"查询取款流水"}));
  fireEvent.click(await screen.findByLabelText("选择清零流水 " + row.source_key));
  fireEvent.click(screen.getByRole("button",{name:"确认清零并入账"}));
  await screen.findByText("取款流水已变化");
  expect(screen.queryByText("台账内容")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"返回查询"}));
  request.mockResolvedValue(preview);
  fireEvent.click(screen.getByRole("button",{name:"查询取款流水"}));
  await waitFor(() => expect(screen.getByRole("button",{name:"确认清零并入账"})).toBeDisabled());
});

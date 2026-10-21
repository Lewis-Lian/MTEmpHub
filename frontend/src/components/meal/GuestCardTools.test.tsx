import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestCardRegistry, GuestRechargeDialog } from "./GuestCardTools";
import type { LedgerRecord } from "../../api/mealLedgers";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ apiRequest: request, buildApiUrl: (path: string) => path }));
const record: LedgerRecord = {
  id: 12, kind: "external", month: "2026-10", date: "2026-10-10", amount: 100,
  name: "客人甲", emp_no: "G01", dept_name: "", card_no: "9001", remark: "",
  category: "card", unit: "", period: "", days: "", registrar: "", operator: "admin",
  voided: false, void_reason: null, guest_card_key: "guest-1", actual_amount: 0, recharge_status: "pending",
};
const candidates = [
  { source_key: "source-1", date: "2026-10-11T10:00:00", amount: 40, matched: false, occupied: false },
  { source_key: "source-2", date: "2026-10-11T11:00:00", amount: 60, matched: true, occupied: false },
  { source_key: "source-3", date: "2026-10-11T12:00:00", amount: 80, matched: false, occupied: true },
];
beforeEach(() => request.mockReset());

describe("客人卡工具", () => {
  it("新增固定身份客人卡并可停用已有卡", async () => {
    request.mockResolvedValue({});
    const changed = vi.fn();
    render(<GuestCardRegistry cards={[{key:"guest-1", card_no:"9001", emp_no:"G01", name:"客人甲", is_active:true}]} onChanged={changed} />);
    fireEvent.click(screen.getByText("客人卡管理"));
    fireEvent.change(screen.getByLabelText("客人卡号"), {target:{value:"9002"}});
    fireEvent.change(screen.getByLabelText("数据库人员编号"), {target:{value:"G02"}});
    fireEvent.change(screen.getByLabelText("客人卡名称"), {target:{value:"客人乙"}});
    fireEvent.click(screen.getByRole("button", {name:"新增客人卡"}));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith("/api/meal-ledgers/guest-cards", {method:"POST", body:{card_no:"9002", emp_no:"G02", name:"客人乙"}});
    fireEvent.click(screen.getByRole("button", {name:"停用 客人甲"}));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenLastCalledWith("/api/meal-ledgers/guest-cards/guest-1", {method:"PUT", body:{is_active:false}});
  });

  it("保存失败保留身份输入并显示错误，停用卡可以重新启用", async () => {
    request.mockRejectedValueOnce(new Error("客人卡号已存在")).mockResolvedValueOnce({});
    const changed = vi.fn();
    render(<GuestCardRegistry cards={[{key:"guest-1", card_no:"9001", emp_no:"G01", name:"客人甲", is_active:false}]} onChanged={changed} />);
    fireEvent.click(screen.getByText("客人卡管理"));
    fireEvent.change(screen.getByLabelText("客人卡号"), {target:{value:"9001"}});
    fireEvent.change(screen.getByLabelText("数据库人员编号"), {target:{value:"G02"}});
    fireEvent.change(screen.getByLabelText("客人卡名称"), {target:{value:"客人乙"}});
    fireEvent.click(screen.getByRole("button", {name:"新增客人卡"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("客人卡号已存在");
    expect(screen.getByLabelText("客人卡名称")).toHaveValue("客人乙");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"启用 客人甲"}));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(request).toHaveBeenLastCalledWith("/api/meal-ledgers/guest-cards/guest-1", {method:"PUT", body:{is_active:true}});
  });

  it("编辑未使用卡回填资料，保存后回到新增模式，取消不提交", async () => {
    request.mockResolvedValue({});
    const changed = vi.fn();
    render(<GuestCardRegistry cards={[{key:"guest-1", card_no:"009001", emp_no:"G01", name:"客人甲", is_active:true, has_history:false}]} onChanged={changed} />);
    fireEvent.click(screen.getByText("客人卡管理"));
    fireEvent.click(screen.getByRole("button", {name:"编辑 客人甲"}));
    expect(screen.getByLabelText("客人卡号")).toHaveValue("009001");
    expect(screen.getByLabelText("数据库人员编号")).toHaveValue("G01");
    fireEvent.change(screen.getByLabelText("客人卡号"), {target:{value:"009002"}});
    fireEvent.change(screen.getByLabelText("数据库人员编号"), {target:{value:"G02"}});
    fireEvent.change(screen.getByLabelText("客人卡名称"), {target:{value:" 新名称 "}});
    fireEvent.click(screen.getByRole("button", {name:"保存修改"}));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("/api/meal-ledgers/guest-cards/guest-1", {method:"PUT", body:{card_no:"009002", emp_no:"G02", name:"新名称"}});
    expect(screen.getByLabelText("客人卡名称")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", {name:"编辑 客人甲"}));
    fireEvent.click(screen.getByRole("button", {name:"取消编辑"}));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", {name:"新增客人卡"})).toBeInTheDocument();
  });

  it("有历史的停用卡只允许改名称，失败保留编辑内容", async () => {
    request.mockRejectedValueOnce(new Error("保存失败"));
    render(<GuestCardRegistry cards={[{key:"guest-1", card_no:"9001", emp_no:"G01", name:"客人甲", is_active:false, has_history:true}]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("客人卡管理"));
    fireEvent.click(screen.getByRole("button", {name:"编辑 客人甲"}));
    expect(screen.getByLabelText("客人卡号")).toBeDisabled();
    expect(screen.getByLabelText("数据库人员编号")).toBeDisabled();
    expect(screen.getByLabelText("客人卡名称")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("客人卡名称"), {target:{value:"改名"}});
    fireEvent.click(screen.getByRole("button", {name:"保存修改"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByLabelText("客人卡名称")).toHaveValue("改名");
    expect(screen.getByRole("button", {name:"保存修改"})).toBeEnabled();
  });

  it("按可延长的日期查询，只能确认未占用且未匹配的充值", async () => {
    request.mockResolvedValueOnce({record, candidates}).mockResolvedValueOnce({record:{...record, actual_amount:40, recharge_status:"partial"}, candidates});
    const updated = vi.fn();
    render(<GuestRechargeDialog record={record} onClose={vi.fn()} onUpdated={updated} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("查询截止日期"), {target:{value:"2026-10-12"}});
    fireEvent.click(screen.getByRole("button", {name:"查询充值"}));
    const selectable = await screen.findByRole("checkbox", {name:"选择充值 source-1"});
    expect(screen.getByRole("checkbox", {name:"选择充值 source-2"})).toBeDisabled();
    expect(screen.getByRole("checkbox", {name:"选择充值 source-3"})).toBeDisabled();
    expect(request).toHaveBeenLastCalledWith("/api/meal-ledgers/records/12/recharge-check", {method:"POST", body:{end_date:"2026-10-12"}});
    fireEvent.click(selectable);
    fireEvent.click(screen.getByRole("button", {name:"确认选中充值"}));
    await waitFor(() => expect(screen.getByLabelText("实际充值")).toHaveTextContent("40.00"));
    expect(request).toHaveBeenLastCalledWith("/api/meal-ledgers/records/12/recharge-check", {method:"POST", body:{end_date:"2026-10-12", source_keys:["source-1"]}});
    expect(updated).toHaveBeenLastCalledWith(expect.objectContaining({actual_amount:40}));
  });

  it("从业务月月初核对，允许查询领用前的当月充值", async () => {
    request.mockResolvedValue({record,candidates:[]});
    render(<GuestRechargeDialog record={record} onClose={vi.fn()} onUpdated={vi.fn()} />);
    expect(screen.getByText("查询起始日期：2026-10-01")).toBeInTheDocument();
    const end = screen.getByLabelText("查询截止日期");
    expect(end).toHaveAttribute("min", "2026-10-01");
    fireEvent.change(end, {target:{value:"2026-10-01"}});
    expect(screen.getByRole("button", {name:"查询充值"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button", {name:"查询充值"}));
    await screen.findByText("该日期范围内暂无充值流水");
    expect(request).toHaveBeenCalledWith("/api/meal-ledgers/records/12/recharge-check", {method:"POST",body:{end_date:"2026-10-01"}});
    fireEvent.change(end, {target:{value:"2026-09-30"}});
    expect(screen.getByRole("button", {name:"查询充值"})).toBeDisabled();
  });

  it("更改日期清空查询结果与选择，失败显示错误并保留已核对金额", async () => {
    request.mockResolvedValueOnce({record:{...record, actual_amount:40, recharge_status:"partial"}, candidates}).mockRejectedValueOnce(new Error("充值数据库不可用"));
    render(<GuestRechargeDialog record={record} onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name:"查询充值"}));
    fireEvent.click(await screen.findByRole("checkbox", {name:"选择充值 source-1"}));
    fireEvent.change(screen.getByLabelText("查询截止日期"), {target:{value:"2026-10-13"}});
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"确认选中充值"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {name:"查询充值"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("充值数据库不可用");
    expect(screen.getByLabelText("实际充值")).toHaveTextContent("40.00");
  });

  it("对话框限制焦点并支持 Escape 关闭和恢复原焦点", () => {
    const close = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener); opener.focus();
    const view = render(<GuestRechargeDialog record={record} onClose={close} onUpdated={vi.fn()} />);
    const dialog = screen.getByRole("dialog", {name:"客人卡充值核对"});
    const closeButton = screen.getByRole("button", {name:"关闭"});
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    closeButton.focus();
    fireEvent.keyDown(closeButton, {key:"Tab"});
    expect(screen.getByLabelText("查询截止日期")).toHaveFocus();
    fireEvent.keyDown(dialog, {key:"Escape"});
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus(); opener.remove();
  });
});

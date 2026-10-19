import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MealTicketQueryPage from "./query/MealTicketQueryPage";
import MealLedgerPage from "./MealLedgerPage";
import MealDownloadPage from "./MealDownloadPage";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request, buildApiUrl: (p: string) => p }));

describe("菜票查询与台账页面", () => {
  beforeEach(() => request.mockReset());
  it("台账月份面板切换业务月份后重新读取记录并清空处理日期", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"admin"} : []));
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    await screen.findByRole("button", {name:"保存记录"});
    fireEvent.change(screen.getByLabelText("处理日期"), {target:{value:"2026-08-20"}});
    const month = screen.getByRole("textbox", {name:"业务月份"});
    fireEvent.click(month);
    fireEvent.click(screen.getByRole("button", {name:"7月"}));
    await waitFor(() => expect(month).toHaveValue(`${new Date().getFullYear()}-07`));
    await waitFor(() => expect(screen.getByLabelText("处理日期")).toHaveValue(""));
    expect(request).toHaveBeenCalledWith(`/api/meal-ledgers/external?month=${new Date().getFullYear()}-07`);
  });
  it("月份未更改时离开月份输入框保留处理日期", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"admin"} : []));
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    await screen.findByRole("button", {name:"保存记录"});
    fireEvent.change(screen.getByLabelText("处理日期"), {target:{value:"2026-10-08"}});
    fireEvent.blur(screen.getByRole("textbox", {name:"业务月份"}));
    expect(screen.getByLabelText("处理日期")).toHaveValue("2026-10-08");
  });
  it("菜票查询独立展示并按人员类型筛选，不提供发放操作", async () => {
    request.mockResolvedValue({ month: "2026-08", recharge_month: "2026-09", status: "confirmed", items: [
      { id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", is_manager: false, days: 22, base_amount: 176, adjustment_amount: 0, due_amount: 176, paid_amount: 176, difference: 0, adjustments: [], payments: [], error: "" },
      { id: 2, emp_no: "002", name: "经理乙", dept_name: "生产部", is_manager: true, days: 20, base_amount: 160, adjustment_amount: 0, due_amount: 160, paid_amount: 160, difference: 0, adjustments: [], payments: [], error: "" },
    ] });
    render(<MemoryRouter><MealTicketQueryPage /></MemoryRouter>);
    await screen.findByText("员工甲");
    fireEvent.change(screen.getByLabelText("人员类型"), { target: { value: "manager" } });
    expect(screen.queryByText("员工甲")).not.toBeInTheDocument();
    expect(screen.getByText("经理乙")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记实际充值" })).not.toBeInTheDocument();
  });

  it("月末取款登记保存实际金额并展示已登记记录", async () => {
    let rows: object[] = [];
    request.mockImplementation((path: string, options?: { body?: object; method?: string }) => {
      if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([]);
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (options?.method === "POST") {
        const record = { id: 1, ...options.body, amount: 20, voided: false };
        rows = [record]; return Promise.resolve(record);
      }
      return Promise.resolve(rows);
    });
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    await screen.findByRole("button", { name: "保存记录" });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "访客甲" } });
    const now = new Date();
    fireEvent.change(screen.getByLabelText("处理日期"), { target: { value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-20` } });
    fireEvent.change(screen.getByLabelText("清零取款金额"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(screen.getByText("访客甲")).toBeInTheDocument());
    expect(screen.getByText("20.00")).toBeInTheDocument();
  });

  it("独立查询保留本月不发原因与处理历史", async () => {
    request.mockResolvedValue({ month: "2026-08", recharge_month: "2026-09", status: "confirmed", items: [
      { id: 1, emp_no: "001", name: "员工甲", dept_name: "生产部", is_manager: false, days: 22,
        base_amount: 0, adjustment_amount: 0, due_amount: 0, paid_amount: 0, difference: 0, error: "",
        excluded: true, participation_history: [{ excluded: true, reason: "离职不结算", operator: "admin", created_at: "2026-09-01" }],
        adjustments: [], payments: [] },
    ] });
    render(<MemoryRouter><MealTicketQueryPage /></MemoryRouter>);
    await screen.findByText("本月不发：离职不结算");
    fireEvent.click(screen.getByRole("button", { name: "查看明细" }));
    expect(screen.getByText(/2026-09-01.*离职不结算/)).toBeInTheDocument();
  });

  it("只有人员查询权限时下载页不暴露年度及外来台账报表", async () => {
    request.mockResolvedValue({ role: "readonly", page_permissions: { meal_ticket_query: true } });
    render(<MemoryRouter><MealDownloadPage /></MemoryRouter>);
    await screen.findByRole("option", { name: "月度充值记录" });
    expect(screen.queryByRole("option", { name: "全年菜票汇总" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "外来人员领用" })).not.toBeInTheDocument();
  });

  it.each(["card", "paper"])("客人 %s 发放登记需承担费用的部门并保存所选类别", async category => {
    let rows: object[] = [];
    request.mockImplementation((path: string, options?: { body?: Record<string, unknown>; method?: string }) => {
      if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([]);
      if (path === "/api/auth/me") return Promise.resolve({role:"admin"});
      if (path === "/api/meal-ledgers/external" && options?.method === "POST") {
        const record = {id:1,...options.body,amount:200,voided:false};
        rows = [record]; return Promise.resolve(record);
      }
      return Promise.resolve(rows);
    });
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    await screen.findByRole("button",{name:"保存记录"});
    expect(screen.getByLabelText("承担费用的部门")).toBeRequired();
    fireEvent.change(screen.getByLabelText("姓名"),{target:{value:"访客甲"}});
    fireEvent.change(screen.getByLabelText("承担费用的部门"),{target:{value:"接待部"}});
    fireEvent.change(screen.getByLabelText("类别"),{target:{value:category}});
    fireEvent.change(screen.getByLabelText("发放金额"),{target:{value:"200"}});
    const now = new Date();
    fireEvent.change(screen.getByLabelText("处理日期"),{target:{value:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-20`}});
    fireEvent.click(screen.getByRole("button",{name:"保存记录"}));
    await screen.findByText("记录已保存");
    expect(screen.getByText("访客甲")).toBeInTheDocument();
    expect(screen.getByText("接待部")).toBeInTheDocument();
    expect(screen.getAllByText(category === "card" ? "充卡" : "纸质").length).toBeGreaterThan(2);
  });

  it("精简领用列表仍可按领用人和类别排序", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"readonly"} : [
      {id:1,date:"2026-10-19",name:"Beta",dept_name:"接待部",category:"paper",amount:20,voided:false},
      {id:2,date:"2026-10-18",name:"Alpha",dept_name:"接待部",category:"card",amount:10,voided:false}
    ]));
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    await screen.findByText("Beta");
    fireEvent.click(screen.getByRole("button", {name:"领用人 / 单位"}));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Alpha");
    fireEvent.click(screen.getByRole("button", {name:"领用人 / 单位"}));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Beta");
    fireEvent.click(screen.getByRole("button", {name:"类别"}));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Alpha");
  });

  it("外来领用默认当天并在连续登记时保留日期、部门和类别", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"admin"} : []));
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    await screen.findByRole("button", {name:"保存记录"});
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    expect(screen.getByLabelText("处理日期")).toHaveValue(today);
    fireEvent.change(screen.getByLabelText("姓名"), {target:{value:"访客甲"}});
    fireEvent.change(screen.getByLabelText("承担费用的部门"), {target:{value:"接待部"}});
    fireEvent.change(screen.getByLabelText("类别"), {target:{value:"paper"}});
    fireEvent.change(screen.getByLabelText("发放金额"), {target:{value:"200"}});
    fireEvent.click(screen.getByRole("button", {name:"保存记录"}));
    await screen.findByText("记录已保存");
    await screen.findByRole("button", {name:"保存记录"});
    expect(screen.getByLabelText("处理日期")).toHaveValue(today);
    expect(screen.getByLabelText("承担费用的部门")).toHaveValue("接待部");
    expect(screen.getByLabelText("类别")).toHaveValue("paper");
    expect(screen.getByLabelText("姓名")).toHaveValue("");
    expect(screen.getByLabelText("发放金额")).toHaveValue(null);
  });

  it("只读账号可通过详情查看收起的历史字段及作废原因", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"readonly"} : [{
      id:1,date:"2026-10-08",name:"访客甲",unit:"合作公司",dept_name:"接待部",category:"paper",amount:200,
      emp_no:"G001",card_no:"C001",period:"10月上旬",days:"3",registrar:"经办甲",operator:"admin",
      remark:"会议接待",voided:true,void_reason:"重复登记",guest_card_key:"guest-1",actual_amount:200,recharge_status:"complete",
      recharges:[{source_key:"card-meal:example:recharge:17",date:"2026-10-08T10:00:00",amount:200}]
    }]));
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", {name:"详情"}));
    const detail = within(screen.getByRole("dialog", {name:"领用记录详情"}));
    for (const text of ["G001","C001","合作公司","10月上旬","3","经办甲","admin","会议接待","重复登记"])
      expect(detail.getByText(text)).toBeInTheDocument();
    expect(detail.getByText("card-meal:example:recharge:17")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name:"保存记录"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name:"作废"})).not.toBeInTheDocument();
    fireEvent.click(detail.getByRole("button", {name:"关闭"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("选择固定客人卡保存访客领用，待到账金额不提前计入发放统计", async () => {
    let rows: object[] = [];
    request.mockImplementation((path: string, options?: {method?:string;body?:Record<string,unknown>}) => {
      if (path === "/api/auth/me") return Promise.resolve({role:"admin"});
      if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([{key:"guest-1",name:"客人卡01",card_no:"0009001",emp_no:"G001",is_active:true}]);
      if (path === "/api/meal-ledgers/external" && options?.method === "POST") {
        rows = [{...options.body,id:1,amount:100,actual_amount:0,recharge_status:"pending",voided:false}];
        return Promise.resolve(rows[0]);
      }
      return Promise.resolve(rows);
    });
    render(<MemoryRouter><MealLedgerPage kind="external" /></MemoryRouter>);
    await screen.findByRole("option", {name:/客人卡01/});
    fireEvent.change(screen.getByLabelText("客人卡"), {target:{value:"guest-1"}});
    fireEvent.change(screen.getByLabelText("姓名"), {target:{value:"来访甲"}});
    fireEvent.change(screen.getByLabelText("承担费用的部门"), {target:{value:"接待部"}});
    fireEvent.change(screen.getByLabelText("应充值金额"), {target:{value:"100"}});
    fireEvent.click(screen.getByRole("button", {name:"保存记录"}));
    await screen.findByText("记录已保存");
    await screen.findByText("来访甲");
    expect(screen.getByText("未充值")).toBeInTheDocument();
    expect(screen.getByRole("button", {name:"核对充值"})).toBeInTheDocument();
    expect(screen.getByLabelText("客人卡")).toHaveValue("guest-1");
    expect(within(screen.getByRole("region", {name:"记录概览统计"})).getAllByText("¥0.00")).toHaveLength(3);
  });

  it("管理员查看部门汇总时没有手工登记和历史导入入口，保留已有历史数据", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"admin"} : {
      month:"2026-09",status:"confirmed",items:[{dept_name:"接待部",count:1,due_amount:1000,paid_amount:1000,
        external_card_amount:200,external_paper_amount:100,total_paid_amount:1300,
        registrar:"历史经办人",remark:"历史说明",historical_amount:1300}]
    }));
    render(<MemoryRouter><MealLedgerPage kind="department" /></MemoryRouter>);
    await screen.findByText("接待部");
    expect(screen.getByRole("heading",{name:"部门菜票发放汇总"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"保存记录"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText("登记人")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();
    expect(screen.getByText("历史经办人")).toBeInTheDocument();
    expect(screen.queryByLabelText("导入文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"历史表格导入"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"查看导入历史"})).not.toBeInTheDocument();
  });

  it("部门统计展示员工及两类客人金额，合计包含纸质菜票", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? {role:"readonly"} : {
      month:"2026-09",status:"confirmed",items:[{dept_name:"接待部",count:1,due_amount:1000,paid_amount:1000,
        external_card_amount:200,external_paper_amount:100,total_paid_amount:1300,
        registrar:"",remark:"",historical_amount:null}]
    }));
    render(<MemoryRouter><MealLedgerPage kind="department" /></MemoryRouter>);
    await screen.findByText("接待部");
    expect(screen.getByRole("columnheader",{name:"员工净实际发放"})).toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:"客人卡充值"})).toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:"客人纸质菜票"})).toBeInTheDocument();
    expect(screen.getByText("200.00")).toBeInTheDocument();
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("1300.00")).toBeInTheDocument();
    expect(screen.getByText("¥1300.00")).toBeInTheDocument();
  });

  it.each(["external", "annual", "clearance"] as const)("%s 页面没有历史导入入口，保留业务登记", async kind => {
    request.mockImplementation((path: string) => {
      if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([]);
      if (path === "/api/auth/me") return Promise.resolve({role:"admin"});
      return Promise.resolve(kind === "annual" ? {
        year:2026,months:[],consumption_months:0,
        totals:{employee_amount:0,external_card_amount:0,recharge_amount:0,paper_amount:0,
          floor2_amount:0,floor3_amount:0,consumption_amount:0,recovered_amount:0}
      } : []);
    });
    render(<MemoryRouter><MealLedgerPage kind={kind} /></MemoryRouter>);
    await screen.findByRole("button",{name:"保存记录"});
    expect(screen.queryByLabelText("导入文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"历史表格导入"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"预览导入"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"查看导入历史"})).not.toBeInTheDocument();
    expect(screen.getByLabelText(kind === "annual" ? "二楼消费金额" : "姓名")).toBeInTheDocument();
  });

  it("台账只读账号可以查记录但没有登记、导入或作废按钮", async () => {
    request.mockImplementation((path: string) => Promise.resolve(path === "/api/meal-ledgers/guest-cards" ? [] : path === "/api/auth/me" ? { role: "readonly" } : [
      { id: 1, date: "2026-09-30", emp_no: "001", name: "员工甲", dept_name: "生产部", amount: 20, voided: false },
    ]));
    render(<MemoryRouter><MealLedgerPage kind="clearance" /></MemoryRouter>);
    await screen.findByText("员工甲");
    expect(screen.queryByRole("button", { name: "保存记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("导入文件")).not.toBeInTheDocument();
  });

  it.each(["clearance", "external"] as const)("%s 作废须填写原因，保存后原记录仍显示作废历史", async kind => {
    let record = { id: 1, date: "2026-09-30", emp_no: "001", name: "员工甲", dept_name: "生产部", amount: 20, voided: false, void_reason: "" };
    request.mockImplementation((path: string, options?: { body?: { reason?: string } }) => {
      if (path === "/api/meal-ledgers/guest-cards") return Promise.resolve([]);
      if (path === "/api/auth/me") return Promise.resolve({ role: "admin" });
      if (path === "/api/meal-ledgers/records/1/void") {
        record = { ...record, voided: true, void_reason: options?.body?.reason ?? "" };
        return Promise.resolve(record);
      }
      return Promise.resolve([record]);
    });
    render(<MemoryRouter><MealLedgerPage kind={kind} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "作废" }));
    expect(screen.getByRole("button", { name: "确认作废" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("作废原因"), { target: { value: "重复录入" } });
    fireEvent.click(screen.getByRole("button", { name: "确认作废" }));
    if (kind === "external") {
      await screen.findByText("已作废");
      fireEvent.click(screen.getByRole("button", {name:"详情"}));
      expect(within(screen.getByRole("dialog", {name:"领用记录详情"})).getByText("重复录入")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", {name:"关闭"}));
    } else await screen.findByText("已作废：重复录入");
    expect(screen.getByText("员工甲")).toBeInTheDocument();
  });
});

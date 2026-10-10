import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MealFollowupQueue from "./MealFollowupQueue";
const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request }));
const task = { key: "a", item_key: "i", emp_no: "00123", name: "张三", dept_name: "财务部", kind: "recharge",
  amount_cents: 2400, allocated_cents: 0, remaining_cents: 2400, status: "pending", version: 2,
  operation_at: null, offset_enabled: true, settings_digest: "setting" };
const queue = { batch_id: 1, batch_version: 3, offset_enabled: true, settings_digest: "setting", queue_offset_enabled: true,
  settings_changed: false, baseline_required: false, baseline_reason: "", current_task_key: "a", tasks: [task] };
const props = { month: "2026-09", batchVersion: 3, refreshRevision: 0, busy: false, onChanged: vi.fn(), onStateChange: vi.fn() };
beforeEach(() => { request.mockReset(); props.onChanged.mockClear(); props.onStateChange.mockClear();
  request.mockResolvedValue(queue); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
it("恢复工号前导零，复制正数两位金额且只在成功后提示", async () => {
  render(<MealFollowupQueue {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "复制工号" }));
  await screen.findByText("工号已复制"); expect(navigator.clipboard.writeText).toHaveBeenCalledWith("00123");
  fireEvent.click(screen.getByRole("button", { name: "复制金额" }));
  await screen.findByText("金额已复制"); expect(navigator.clipboard.writeText).toHaveBeenCalledWith("24.00");
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "复制工号" }));
  await screen.findByText("复制失败，请重试"); expect(screen.queryByText("工号已复制")).not.toBeInTheDocument();
});
it.each(["recharge", "refund"])("%s 保存成功才切下一项，失败复用请求键且不写支付", async kind => {
  const initial = { ...queue, tasks: [{ ...task, kind }, { ...task, key: "b", emp_no: "002", name: "李四" }] };
  let finish!: (value: unknown) => void;
  request.mockImplementation((path: string) => path.includes("/progress") ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(initial));
  render(<MealFollowupQueue {...props} />);
  const label = kind === "refund" ? "已完成取款，下一人" : "已完成充值，下一人";
  fireEvent.click(await screen.findByRole("button", { name: label }));
  expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("00123");
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
  await act(async () => finish({ ...initial, batch_version: 4, current_task_key: "b", tasks: [{ ...initial.tasks[0], status: "awaiting" }, initial.tasks[1]] }));
  expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("002");
  expect(screen.getByRole("region", { name: "待核对任务" })).toHaveTextContent("张三");
  expect(request).toHaveBeenCalledWith("/api/meal-tickets/followup-tasks/a/progress", expect.objectContaining({ body: expect.objectContaining({ action: "complete", version: 3, task_version: 2, settings_digest: "setting" }) }));
  expect(request.mock.calls.some(([path]) => path === "/api/meal-tickets/payments")).toBe(false);
});
it("失败留在原工号，重试复用幂等请求键", async () => {
  request.mockImplementation((path: string) => path.includes("/progress") ? Promise.reject(new Error("保存失败")) : Promise.resolve(queue));
  render(<MealFollowupQueue {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "已完成充值，下一人" }));
  await screen.findByText("保存失败");
  fireEvent.click(screen.getByRole("button", { name: "已完成充值，下一人" }));
  await waitFor(() => expect(request.mock.calls.filter(([path]) => path.includes("/progress"))).toHaveLength(2));
  const calls = request.mock.calls.filter(([path]) => path.includes("/progress"));
  expect(calls[0][1].body).toEqual(calls[1][1].body);
  expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("00123");
});
it("服务端定位与跳过顺序原样恢复，名单只选择，搜索不换当前卡", async () => {
  const initial = { ...queue, current_task_key: "b", tasks: [{ ...task, key: "b", emp_no: "002", name: "李四" }, { ...task, status: "skipped" }] };
  request.mockImplementation((path: string, options?: { body: { action: string } }) => Promise.resolve(path.includes("/progress")
    ? { ...initial, current_task_key: options?.body.action === "skip" ? "a" : "b", batch_version: 4 } : initial));
  const first = render(<MealFollowupQueue {...props} />);
  await screen.findByRole("button", { name: "暂时跳过" });
  expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("李四");
  const list = within(screen.getByRole("region", { name: "办理名单" }));
  expect(list.getAllByRole("button").map(button => button.textContent)).toEqual([expect.stringContaining("002"), expect.stringContaining("00123")]);
  fireEvent.change(screen.getByLabelText("搜索办理任务"), { target: { value: "00123" } });
  expect(list.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("李四");
  fireEvent.click(screen.getByRole("button", { name: "暂时跳过" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("张三"));
  first.unmount(); request.mockResolvedValue({ ...initial, current_task_key: "a" });
  render(<MealFollowupQueue {...props} />);
  await waitFor(() => expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("00123"));
});
it("设置变化冻结旧卡片，刷新保留待核对与部分到账，重办必须填原因", async () => {
  const initial = { ...queue, settings_changed: true, offset_enabled: false, tasks: [task, { ...task, key: "c", status: "partial", amount_cents: 2400, allocated_cents: 1000, remaining_cents: 1400 }] };
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("/refresh")
    ? { ...initial, settings_changed: false } : path.includes("/progress")
    ? { ...initial, settings_changed: false, current_task_key: "c", tasks: [task, { ...initial.tasks[1], status: "pending" }] } : initial));
  render(<MealFollowupQueue {...props} />);
  expect(await screen.findByText("设置已变化，请刷新操作清单")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成充值，下一人" })).toBeDisabled();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "待核对任务" })).toHaveTextContent("已匹配 10.00 元 · 剩余 14.00 元");
  fireEvent.click(screen.getByRole("button", { name: "刷新操作清单" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "已完成充值，下一人" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认尚未到账，重新办理" }));
  const dialog = within(screen.getByRole("dialog", { name: "确认重新办理" }));
  expect(dialog.getByRole("button", { name: "确认重新办理" })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText("重新办理原因"), { target: { value: "已向设备确认未到账" } });
  fireEvent.click(dialog.getByRole("button", { name: "确认重新办理" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("充值 14.00 元"));
});
it("未生成的旧月清单只提示核对基线，不自动生成历史任务", async () => {
  request.mockResolvedValue({ ...queue, tasks: [], current_task_key: null, baseline_required: true, baseline_reason: "请先核对实际流水并确认剩余义务基线" });
  render(<MealFollowupQueue {...props} />);
  await screen.findByText("请先核对实际流水并确认剩余义务基线");
  expect(screen.queryByText("已结清")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "刷新操作清单" })).toBeDisabled();
  expect(request.mock.calls).toHaveLength(1);
});
it("父页正在批量登记时不刷新写清单，结束后自动更新摘要", async () => {
  const view = render(<MealFollowupQueue {...props} />);
  await screen.findByRole("button", { name: "已完成充值，下一人" });
  request.mockClear();
  view.rerender(<MealFollowupQueue {...props} batchVersion={4} refreshRevision={1} busy />);
  await act(async () => {});
  expect(request.mock.calls.some(([path]) => path.endsWith("/refresh"))).toBe(false);
  view.rerender(<MealFollowupQueue {...props} batchVersion={4} refreshRevision={1} />);
  await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("/refresh"))).toBe(true));
});
it("清单切到下一项后，旧复制响应不提示新工号已复制", async () => {
  let finishCopy!: () => void;
  vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise(resolve => { finishCopy = resolve; }));
  request.mockImplementation((path: string) => Promise.resolve(path.includes("/progress")
    ? { ...queue, current_task_key: "b", tasks: [{ ...task, status: "awaiting" }, { ...task, key: "b", emp_no: "002" }] } : queue));
  render(<MealFollowupQueue {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "复制工号" }));
  fireEvent.click(screen.getByRole("button", { name: "已完成充值，下一人" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("002"));
  await act(async () => finishCopy());
  expect(screen.queryByText("工号已复制")).not.toBeInTheDocument();
});
it("首次读取失败仍能在原入口刷新恢复", async () => {
  request.mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue(queue);
  render(<MealFollowupQueue {...props} />);
  await screen.findByText("读取失败");
  fireEvent.click(screen.getByRole("button", { name: "刷新操作清单" }));
  await screen.findByRole("button", { name: "已完成充值，下一人" });
});
it("父页金额版本领先清单时旧卡片不可提交", async () => {
  render(<MealFollowupQueue {...props} batchVersion={4} />);
  await screen.findByRole("button", { name: "已完成充值，下一人" });
  expect(screen.getByRole("button", { name: "已完成充值，下一人" })).toBeDisabled();
});
it("选择名单只保存服务端定位，撤销标记不写支付", async () => {
  const initial = { ...queue, tasks: [task, { ...task, key: "b", emp_no: "002" }, { ...task, key: "c", status: "awaiting" }] };
  request.mockImplementation((path: string, options?: { body: { action: string } }) => Promise.resolve(path.includes("/progress")
    ? { ...initial, batch_version: 4, current_task_key: options?.body.action === "select" ? "b" : "c", tasks: initial.tasks.map(t => options?.body.action === "undo" && t.key === "c" ? { ...t, status: "pending" } : t) } : initial));
  render(<MealFollowupQueue {...props} />);
  const list = within(await screen.findByRole("region", { name: "办理名单" }));
  fireEvent.click(list.getByRole("button", { name: /002/ }));
  await waitFor(() => expect(screen.getByRole("region", { name: "当前办理任务" })).toHaveTextContent("002"));
  expect(request).toHaveBeenCalledWith("/api/meal-tickets/followup-tasks/b/progress", expect.objectContaining({ body: expect.objectContaining({ action: "select" }) }));
  fireEvent.click(screen.getByRole("button", { name: "未实际操作，撤销标记" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/meal-tickets/followup-tasks/c/progress", expect.objectContaining({ body: expect.objectContaining({ action: "undo" }) })));
  expect(request.mock.calls.some(([path]) => path.includes("/payments"))).toBe(false);
});

it("旧月人工确认剩余方向与说明后才生成任务", async () => {
  const initial = { ...queue, tasks: [], baseline_required: true,
    baseline_items: [{ item_key: "old-item", emp_no: "00123", name: "张三", due_cents: 20000, paid_cents: 17600, difference_cents: 2400 }] };
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("/refresh") ? queue : initial));
  render(<MealFollowupQueue {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认旧月剩余基线" }));
  const dialog = within(screen.getByRole("dialog", { name: "确认旧月剩余基线" }));
  expect(dialog.getByLabelText("00123 待充值（元）")).toHaveValue(24);
  expect(dialog.getByRole("button", { name: "核实并生成清单" })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText("00123 待充值（元）"), { target: { value: "40" } });
  fireEvent.change(dialog.getByLabelText("00123 待取款（元）"), { target: { value: "16" } });
  fireEvent.change(dialog.getByLabelText("基线核实说明"), { target: { value: "逐笔核实历史流水，尚需分别40和16" } });
  fireEvent.click(dialog.getByRole("button", { name: "核实并生成清单" }));
  await screen.findByRole("button", { name: "已完成充值，下一人" });
  expect(request).toHaveBeenCalledWith("/api/meal-tickets/followup-tasks/refresh", expect.objectContaining({ body: expect.objectContaining({
    baselines: { "old-item": { recharge_cents: 4000, refund_cents: 1600, reason: "逐笔核实历史流水，尚需分别40和16" } } }) }));
});
it("同额歧义选择真实流水和金额后更新部分到账", async () => {
  const initial = { ...queue, current_task_key: null, tasks: [{ ...task, status: "awaiting", candidates: { requires_confirmation: true,
    payments: [{ payment_key: "p1", available_cents: 1200, date: "2026-09-02", reference: "设备凭证1" },
      { payment_key: "p2", available_cents: 1200, date: "2026-09-02", reference: "设备凭证2" }] } }] };
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("/allocations") ? { ...initial, batch_version: 4,
    tasks: [{ ...initial.tasks[0], status: "partial", allocated_cents: 1200, remaining_cents: 1200 }] } : initial));
  render(<MealFollowupQueue {...props} />);
  expect(await screen.findByText(/待确认实际流水关联/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "已完成充值，下一人" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关联实际流水 · 00123 充值" }));
  const dialog = within(screen.getByRole("dialog", { name: "关联实际流水" }));
  fireEvent.change(dialog.getByLabelText("实际流水"), { target: { value: "p2" } });
  fireEvent.change(dialog.getByLabelText("关联金额（元）"), { target: { value: "12" } });
  fireEvent.click(dialog.getByRole("button", { name: "确认关联" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "待核对任务" })).toHaveTextContent("已匹配 12.00 元 · 剩余 12.00 元"));
  expect(request).toHaveBeenCalledWith("/api/meal-tickets/followup-tasks/a/allocations", expect.objectContaining({ body: expect.objectContaining({ payment_key: "p2", amount_cents: 1200, task_version: 2, version: 3 }) }));
});

it("基线确认使用页面所见版本，拒绝期间变化而不改用最新版本提交旧确认", async () => {
  const initial = { ...queue, tasks: [], baseline_required: true, baseline_items: [{ item_key: "i", emp_no: "00123", name: "张三", due_cents: 2400, paid_cents: 0, difference_cents: 2400 }] };
  let reads = 0;
  request.mockImplementation((path: string, options?: { body: { version: number } }) => {
    if (path.endsWith("/refresh")) return options?.body.version === 3 ? Promise.reject(Object.assign(new Error("数据已变化"), { status: 409 })) : Promise.resolve(queue);
    return Promise.resolve({ ...initial, batch_version: ++reads === 1 ? 3 : 4 });
  });
  render(<MealFollowupQueue {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认旧月剩余基线" }));
  const dialog = within(screen.getByRole("dialog", { name: "确认旧月剩余基线" }));
  fireEvent.change(dialog.getByLabelText("基线核实说明"), { target: { value: "已逐笔核实" } });
  fireEvent.click(dialog.getByRole("button", { name: "核实并生成清单" }));
  await waitFor(() => expect(request.mock.calls.find(([path]) => path.endsWith("/refresh"))?.[1].body.version).toBe(3));
  expect(screen.getByRole("dialog", { name: "确认旧月剩余基线" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取核对基线" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认旧月剩余基线" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "确认旧月剩余基线" })).toBeEnabled();
  expect(request.mock.calls.filter(([path]) => path.endsWith("/refresh"))).toHaveLength(1);
});

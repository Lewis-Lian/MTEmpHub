import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/feedback/ConfirmDialog";

vi.mock("../../api/messages", () => ({
  fetchMessageRecipients: vi.fn().mockResolvedValue([{ id: 2, account_ids: [7], emp_no: "E002", name: "张三", dept_id: 10, dept_name: "制造部", is_manager: false }]),
  sendMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../api/admin", () => ({
  fetchAdminDepartments: vi.fn().mockResolvedValue([{ id: 10, dept_no: "D10", dept_name: "制造部", parent_id: null }]),
}));
vi.mock("../../components/editor/RichTextEditor", () => ({
  default: ({ ariaLabel, onChange }: { ariaLabel: string; onChange: (html: string) => void }) => (
    <div aria-label={ariaLabel} contentEditable onInput={(event) => onChange(event.currentTarget.innerHTML)} suppressContentEditableWarning />
  ),
}));

describe("AdminMessagesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a message from the system settings page", async () => {
    const { default: AdminMessagesPage } = await import("./AdminMessagesPage");
    render(<ConfirmProvider><AdminMessagesPage /></ConfirmProvider>);
    expect(await screen.findByRole("heading", { name: "发送消息" })).toBeInTheDocument();
    expect(screen.getByText("请选择需要接收消息的员工，可多选。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /选择员工/ }));
    expect(screen.getByRole("button", { name: "制造部" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("E002 - 张三"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "选择员工" })).getByRole("button", { name: "确定" }));
    fireEvent.change(screen.getByLabelText("消息标题"), { target: { value: "公告" } });
    const editor = screen.getByLabelText("消息内容");
    editor.innerHTML = "请查收";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.getByText("消息发送成功")).toBeInTheDocument());
  });

  it("编辑器只有空占位段落时不发送并提示内容不能为空", async () => {
    const { default: AdminMessagesPage } = await import("./AdminMessagesPage");
    const { sendMessage } = await import("../../api/messages");
    render(<ConfirmProvider><AdminMessagesPage /></ConfirmProvider>);
    await screen.findByRole("heading", { name: "发送消息" });
    fireEvent.click(screen.getByRole("button", { name: /选择员工/ }));
    fireEvent.click(screen.getByLabelText("E002 - 张三"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "选择员工" })).getByRole("button", { name: "确定" }));
    fireEvent.change(screen.getByLabelText("消息标题"), { target: { value: "公告" } });
    const editor = screen.getByLabelText("消息内容");
    editor.innerHTML = "<p><br></p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.getByText("消息内容不能为空")).toBeInTheDocument());
    expect(sendMessage).not.toHaveBeenCalled();
    editor.innerHTML = "请查收";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.getByText("消息发送成功")).toBeInTheDocument());
    expect(screen.queryByText("消息内容不能为空")).not.toBeInTheDocument();
  });

  it("编辑器只有空白字符段落时同样拦截", async () => {
    const { default: AdminMessagesPage } = await import("./AdminMessagesPage");
    const { sendMessage } = await import("../../api/messages");
    render(<ConfirmProvider><AdminMessagesPage /></ConfirmProvider>);
    await screen.findByRole("heading", { name: "发送消息" });
    fireEvent.click(screen.getByRole("button", { name: /选择员工/ }));
    fireEvent.click(screen.getByLabelText("E002 - 张三"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "选择员工" })).getByRole("button", { name: "确定" }));
    fireEvent.change(screen.getByLabelText("消息标题"), { target: { value: "公告" } });
    const editor = screen.getByLabelText("消息内容");
    editor.innerHTML = "<p>   </p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.getByText("消息内容不能为空")).toBeInTheDocument());
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("选择全部管理人员范围时按范围群发并提示发送人数", async () => {
    const { default: AdminMessagesPage } = await import("./AdminMessagesPage");
    const { sendMessage } = await import("../../api/messages");
    vi.mocked(sendMessage).mockResolvedValueOnce({
      created_count: 3,
      message: { id: 9, title: "停机公告", content: "<p>周五停机</p>", sender: "系统管理员", created_at: "2026-09-14T00:00:00", unread: true },
    });
    render(<ConfirmProvider><AdminMessagesPage /></ConfirmProvider>);
    await screen.findByRole("heading", { name: "发送消息" });
    fireEvent.click(screen.getByRole("radio", { name: "全部管理人员" }));
    expect(screen.queryByRole("button", { name: /选择员工/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("消息标题"), { target: { value: "停机公告" } });
    const editor = screen.getByLabelText("消息内容");
    editor.innerHTML = "<p>周五停机</p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.getByText("已向 3 人发送消息")).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({ recipient_scope: "managers", title: "停机公告", content: "<p>周五停机</p>" });
  });
});

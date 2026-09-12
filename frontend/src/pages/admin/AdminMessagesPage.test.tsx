import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/feedback/ConfirmDialog";

vi.mock("../../api/messages", () => ({
  fetchMessageRecipients: vi.fn().mockResolvedValue([{ id: 2, account_ids: [7], emp_no: "E002", name: "张三", dept_id: 10, dept_name: "制造部", is_manager: false }]),
  sendMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../api/admin", () => ({
  fetchAdminDepartments: vi.fn().mockResolvedValue([{ id: 10, dept_no: "D10", dept_name: "制造部", parent_id: null }]),
}));

describe("AdminMessagesPage", () => {
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
});

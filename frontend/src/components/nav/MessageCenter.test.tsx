import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MessageCenter from "./MessageCenter";

vi.mock("../../api/messages", () => ({
  fetchMessages: vi.fn().mockResolvedValue({
    messages: [{ id: 1, title: "系统通知", content: "请查收", sender: "系统管理员", created_at: "2026-09-12T00:00:00", unread: true }],
    unread_count: 1,
  }),
  markMessageRead: vi.fn().mockResolvedValue({}),
  fetchMessageRecipients: vi.fn().mockResolvedValue([{ id: 2, username: "张三", profile_name: "张三" }]),
  sendMessage: vi.fn().mockResolvedValue({}),
}));

describe("MessageCenter", () => {
  it("opens messages and shows unread count", async () => {
    render(<MessageCenter />);
    await waitFor(() => expect(screen.getByRole("button", { name: /消息/ })).toHaveTextContent("1"));
    fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    expect(await screen.findByText("系统通知")).toBeInTheDocument();
  });

  it("does not show the admin send form in the message panel", async () => {
    render(<MessageCenter />);
    fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    expect(screen.queryByRole("heading", { name: "发送消息" })).not.toBeInTheDocument();
  });
});

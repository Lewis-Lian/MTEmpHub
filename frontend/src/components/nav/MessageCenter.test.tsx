import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import MessageCenter from "./MessageCenter";
import { markMessageRead } from "../../api/messages";

vi.mock("../../api/messages", () => ({
  fetchMessages: vi.fn().mockResolvedValue({
    messages: [{ id: 1, title: "系统通知", content: "<p>请查收<b>公告</b></p>", sender: "系统管理员", created_at: "2026-09-12T00:00:00", unread: true }],
    unread_count: 1,
  }),
  markMessageRead: vi.fn().mockResolvedValue({}),
  fetchMessage: vi.fn().mockResolvedValue({}),
  fetchMessageRecipients: vi.fn().mockResolvedValue([{ id: 2, username: "张三", profile_name: "张三" }]),
  sendMessage: vi.fn().mockResolvedValue({}),
}));

async function renderMessageCenter() {
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MemoryRouter>
        <Routes>
          <Route element={<MessageCenter />} path="*" />
          <Route element={<p>消息详情占位页</p>} path="/employee/messages/:id" />
        </Routes>
      </MemoryRouter>,
    );
  });
  return view!;
}

describe("MessageCenter", () => {
  it("opens messages and shows unread count", async () => {
    await renderMessageCenter();
    await waitFor(() => expect(screen.getByRole("button", { name: /消息/ })).toHaveTextContent("1"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    expect(await screen.findByText("系统通知")).toBeInTheDocument();
  });

  it("does not show the admin send form in the message panel", async () => {
    await renderMessageCenter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    expect(screen.queryByRole("heading", { name: "发送消息" })).not.toBeInTheDocument();
  });

  it("列表预览显示纯文本摘要而非原始 HTML 标签", async () => {
    await renderMessageCenter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    const preview = await screen.findByText(/请查收/);
    expect(preview).toHaveTextContent("请查收公告");
    expect(preview).not.toHaveTextContent("<p>");
  });

  it("点击消息跳转到消息详情页并标记已读", async () => {
    await renderMessageCenter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("系统通知"));
    });
    expect(await screen.findByText("消息详情占位页")).toBeInTheDocument();
    await waitFor(() => expect(markMessageRead).toHaveBeenCalledWith(1));
  });
});

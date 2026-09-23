import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import MessageCenter from "./MessageCenter";
import { fetchMessages, markMessageRead } from "../../api/messages";

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

  it("正确识别不同公告类型并赋予相应语义标签", async () => {
    const { parseMessageMeta } = await import("./MessageCenter");
    expect(parseMessageMeta("【重要公告】关于国庆放假").category).toBe("announcement");
    expect(parseMessageMeta("【重要公告】关于国庆放假").tag).toBe("重要公告");

    expect(parseMessageMeta("【考勤提醒】请及时打卡").category).toBe("attendance");
    expect(parseMessageMeta("【考勤提醒】请及时打卡").tag).toBe("考勤提醒");

    expect(parseMessageMeta("【节假日通知】端午节放假安排").category).toBe("holiday");
    expect(parseMessageMeta("【节假日通知】端午节放假安排").tag).toBe("节假日通知");

    expect(parseMessageMeta("【温馨提示】天气变冷注意保暖").category).toBe("reminder");
    expect(parseMessageMeta("【温馨提示】天气变冷注意保暖").tag).toBe("温馨提示");

    expect(parseMessageMeta("【系统通知】系统升级维护").category).toBe("system");
    expect(parseMessageMeta("【系统通知】系统升级维护").tag).toBe("系统通知");
  });

  it("支持快捷全部标为已读操作", async () => {
    await renderMessageCenter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    const quickReadBtn = await screen.findByRole("button", { name: "一键全部已读" });
    expect(quickReadBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(quickReadBtn);
    });
    await waitFor(() => expect(markMessageRead).toHaveBeenCalledWith(1));
  });

  it("批量标记部分失败时仅更新成功消息并保留失败项未读", async () => {
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [
        { id: 1, title: "成功消息", content: "内容", sender: "系统管理员", created_at: "2026-09-12T00:00:00", unread: true },
        { id: 2, title: "失败消息", content: "内容", sender: "系统管理员", created_at: "2026-09-12T00:00:00", unread: true },
      ],
      unread_count: 2,
    });
    vi.mocked(markMessageRead).mockImplementation((id) => id === 1 ? Promise.resolve({} as never) : Promise.reject(new Error("失败")));
    const notification = vi.spyOn(window, "dispatchEvent");

    await renderMessageCenter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /消息/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "一键全部已读" }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /消息/ })).toHaveTextContent("1"));
    expect(screen.getByText("成功消息").closest("article")).not.toHaveClass("is-unread");
    expect(screen.getByText("失败消息").closest("article")).toHaveClass("is-unread");
    expect(notification).toHaveBeenCalledWith(expect.objectContaining({ type: "show-notification" }));
    notification.mockRestore();
  });
});


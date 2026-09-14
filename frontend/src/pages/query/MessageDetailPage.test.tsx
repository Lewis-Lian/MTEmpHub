import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { fetchMessage, markMessageRead } from "../../api/messages";

vi.mock("../../api/messages", () => ({
  fetchMessage: vi.fn(),
  markMessageRead: vi.fn().mockResolvedValue({}),
}));

import MessageDetailPage from "./MessageDetailPage";

const baseMessage = {
  id: 5,
  title: "放假通知",
  content: "<p>正文内容</p>",
  sender: "系统管理员",
  created_at: "2026-09-12T08:00:00",
  unread: false,
};

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/employee/messages/5"]}>
      <Routes>
        <Route element={<MessageDetailPage />} path="/employee/messages/:id" />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MessageDetailPage", () => {
  it("按路由参数加载并展示消息标题、发件人与正文", async () => {
    vi.mocked(fetchMessage).mockResolvedValue(baseMessage);
    renderDetailPage();
    expect(await screen.findByRole("heading", { name: "放假通知" })).toBeInTheDocument();
    expect(screen.getByText("系统管理员")).toBeInTheDocument();
    expect(screen.getByText("正文内容")).toBeInTheDocument();
    expect(fetchMessage).toHaveBeenCalledWith(5);
  });

  it("渲染正文前清除脚本与事件属性", async () => {
    vi.mocked(fetchMessage).mockResolvedValue({
      ...baseMessage,
      content: '<p onclick="alert(1)">安全正文</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
    });
    renderDetailPage();
    expect(await screen.findByText("安全正文")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(document.querySelector("img")?.getAttribute("onerror")).toBeNull();
  });

  it("未读消息进入详情页后自动标记已读", async () => {
    vi.mocked(fetchMessage).mockResolvedValue({ ...baseMessage, unread: true });
    renderDetailPage();
    await waitFor(() => expect(markMessageRead).toHaveBeenCalledWith(5));
  });

  it("消息不存在时展示错误提示", async () => {
    vi.mocked(fetchMessage).mockRejectedValue(new ApiError("消息不存在", 404, {}));
    renderDetailPage();
    expect(await screen.findByText("消息不存在")).toBeInTheDocument();
  });

  it("旧版纯文本消息原样渲染，不被当作 HTML", async () => {
    vi.mocked(fetchMessage).mockResolvedValue({ ...baseMessage, content: "旧版纯文本通知" });
    renderDetailPage();
    expect(await screen.findByText("旧版纯文本通知")).toBeInTheDocument();
    expect(document.querySelector(".message-detail-body p")).not.toBeInTheDocument();
  });
});

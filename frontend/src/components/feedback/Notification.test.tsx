import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationProvider, triggerNotification } from "./Notification";

afterEach(() => cleanup());

function Probe() {
  return (
    <NotificationProvider>
      <button onClick={() => triggerNotification("操作成功", "success", 80)}>触发</button>
    </NotificationProvider>
  );
}

describe("Notification", () => {
  it("事件触发后滑入出现通知", async () => {
    render(<Probe />);
    fireEvent.click(screen.getByText("触发"));
    expect(await screen.findByText("操作成功")).toBeInTheDocument();
  });

  it("到期后经退场动画从 DOM 移除", async () => {
    render(<Probe />);
    fireEvent.click(screen.getByText("触发"));
    expect(await screen.findByText("操作成功")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("操作成功")).toBeNull(), { timeout: 2000 });
  });

  it("点击关闭按钮立即进入退场并移除", async () => {
    render(<Probe />);
    fireEvent.click(screen.getByText("触发"));
    expect(await screen.findByText("操作成功")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByText("操作成功")).toBeNull());
  });
});

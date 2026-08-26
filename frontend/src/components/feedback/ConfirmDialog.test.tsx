import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

afterEach(() => cleanup());

let lastResult: boolean | undefined;

function Probe() {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        lastResult = await confirm({ message: "确定删除这条记录？", type: "danger" });
      }}
    >
      打开
    </button>
  );
}

describe("ConfirmDialog", () => {
  it("confirm() 后弹出对话框，点确定 resolve(true) 并退场移除", async () => {
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("打开"));
    expect(await screen.findByText("确定删除这条记录？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(lastResult).toBe(true));
    await waitFor(() => expect(screen.queryByText("确定删除这条记录？")).toBeNull());
  });

  it("点取消 resolve(false) 并退场移除", async () => {
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("打开"));
    expect(await screen.findByText("确定删除这条记录？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(lastResult).toBe(false));
    await waitFor(() => expect(screen.queryByText("确定删除这条记录？")).toBeNull());
  });
});

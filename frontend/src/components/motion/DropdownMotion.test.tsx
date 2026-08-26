import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import DropdownMotion from "./DropdownMotion";

afterEach(() => cleanup());

function Probe({ initial = false }: { initial?: boolean }) {
  const [isOpen, setIsOpen] = useState(initial);
  return (
    <>
      <button onClick={() => setIsOpen((v) => !v)}>开关</button>
      <DropdownMotion className="probe-panel" isOpen={isOpen}>
        <p>面板内容</p>
      </DropdownMotion>
    </>
  );
}

describe("DropdownMotion", () => {
  it("isOpen 为 true 时渲染 children", () => {
    render(<Probe initial />);
    expect(screen.getByText("面板内容")).toBeInTheDocument();
  });

  it("isOpen 为 false 时不渲染 children", () => {
    render(<Probe />);
    expect(screen.queryByText("面板内容")).toBeNull();
  });

  it("关闭后内容经退场动画移除，className 透传到动画宿主元素", async () => {
    render(<Probe initial />);
    expect(screen.getByText("面板内容").closest(".probe-panel")).not.toBeNull();
    fireEvent.click(screen.getByText("开关"));
    await waitFor(() => expect(screen.queryByText("面板内容")).toBeNull());
  });
});

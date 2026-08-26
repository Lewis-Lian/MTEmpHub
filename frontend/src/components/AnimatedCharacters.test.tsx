import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AnimatedCharacters from "./AnimatedCharacters";

afterEach(() => cleanup());

describe("AnimatedCharacters", () => {
  it("渲染角色且鼠标移动不抛错（瞳孔 motion value 路径）", () => {
    render(<AnimatedCharacters isTyping={false} passwordLength={3} showPassword={false} />);
    expect(screen.getByTestId("animated-purple-character")).toBeInTheDocument();
    expect(screen.getByTestId("animated-purple-eyes")).toBeInTheDocument();
    // 触发 mousemove 热路径：useMotionValue 更新不应重渲染或抛错
    fireEvent.mouseMove(window, { clientX: 120, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 40, clientY: 200 });
    expect(screen.getByTestId("animated-purple-character")).toBeInTheDocument();
  });
});

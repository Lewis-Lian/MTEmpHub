import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QueryProgressOverlay from "./QueryProgressOverlay";

describe("QueryProgressOverlay", () => {
  it("shows progress, status text, and milestone markers while active", () => {
    render(<QueryProgressOverlay active progress={64} text="正在整理考勤数据..." />);

    expect(screen.getByRole("status")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("正在整理考勤数据...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").querySelectorAll(".query-progress-milestone")).toHaveLength(4);
    expect(screen.getByText("准备")).toHaveClass("is-reached");
    expect(screen.getByText("读取")).toHaveClass("is-reached");
    expect(screen.getByText("处理")).toHaveClass("is-current");
    expect(screen.getByText("完成")).toHaveClass("is-pending");
    expect(screen.getByText("PROCESSING")).toBeInTheDocument();
  });

  it("shows check icon and reaches final stage when completed at 100%", () => {
    const { container } = render(<QueryProgressOverlay active progress={100} text="数据处理完成" />);

    expect(screen.getByRole("status")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("完成")).toHaveClass("is-reached");
    expect(container.querySelector(".query-progress-check")).toBeInTheDocument();
    expect(container.querySelector(".query-progress-spinner")).not.toBeInTheDocument();
  });

  it("keeps the overlay hidden when inactive", () => {
    render(<QueryProgressOverlay active={false} progress={0} text="等待中" />);

    expect(screen.getByRole("status")).not.toHaveClass("is-active");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});


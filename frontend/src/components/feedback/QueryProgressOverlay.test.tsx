import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QueryProgressOverlay, { QueryProgressCard } from "./QueryProgressOverlay";

describe("QueryProgressOverlay", () => {
  it("shows progress, status text, and milestone markers while active", () => {
    render(<QueryProgressOverlay active progress={64} text="正在整理考勤数据..." />);

    expect(screen.getByRole("status")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("正在整理考勤数据...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").querySelectorAll(".query-progress-milestone")).toHaveLength(4);
    expect(screen.getByText("PROCESSING")).toBeInTheDocument();
  });

  it("shows check icon and reaches final stage when completed at 100%", () => {
    const { container } = render(<QueryProgressOverlay active progress={100} text="数据处理完成" />);

    expect(screen.getByRole("status")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(container.querySelector(".query-progress-check")).toBeInTheDocument();
    expect(container.querySelector(".query-progress-spinner")).not.toBeInTheDocument();
  });

  it("keeps the overlay hidden when inactive", () => {
    render(<QueryProgressOverlay active={false} progress={0} text="等待中" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});


describe("actual task progress", () => {
  it("does not announce a percentage or completed steps when progress is unknown", () => {
    const { container } = render(<QueryProgressOverlay active progress={null} text="正在等待服务器" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("处理中")).toBeInTheDocument();
    expect(container.querySelector(".query-progress-check")).not.toBeInTheDocument();
    expect(container.querySelector(".query-progress-milestones")).not.toBeInTheDocument();
  });

  it("preserves fractional backend progress and details in an inline card", () => {
    render(<QueryProgressCard progress={37.5} label="快照处理进度" text="正在保存员工">
      <p>已处理 3 / 8 人</p>
    </QueryProgressCard>);
    expect(screen.getByRole("progressbar", { name: "快照处理进度" })).toHaveAttribute("aria-valuenow", "37.5");
    expect(screen.getByText("已处理 3 / 8 人")).toBeInTheDocument();
  });

  it("does not show completion when a failed stage reached 100 percent", () => {
    const { container } = render(<QueryProgressCard progress={100} status="failed" text="恢复失败" />);
    expect(screen.getByText("未完成")).toBeInTheDocument();
    expect(container.querySelector(".query-progress-check")).not.toBeInTheDocument();
    expect(container.querySelector(".query-progress-spinner")).not.toBeInTheDocument();
  });
});

it("keeps a prepared batch still until submission", () => {
  const { container } = render(<QueryProgressCard progress={0} status="pending" text="准备就绪，等待确认" />);
  expect(screen.getByText("待开始")).toBeInTheDocument();
  expect(container.querySelector(".query-progress-spinner")).not.toBeInTheDocument();
  expect(container.querySelector(".query-progress-sweep")).not.toBeInTheDocument();
});

it("keeps an unknown failed task from displaying a full rail", () => {
  render(<QueryProgressCard progress={null} status="failed" text="连接失败" />);
  expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ transform: "scaleX(0)" });
});

it("shows completion when an explicit completed result omits a percentage", () => {
  const { container } = render(<QueryProgressCard progress={null} status="completed" text="处理完成" />);
  expect(screen.getByText("100%")).toBeInTheDocument();
  expect(container.querySelector(".query-progress-check")).toBeInTheDocument();
});

describe("shared overlay scope", () => {
  it("covers the whole active tab instead of a constrained query panel", () => {
    const { container } = render(<div className="app-content" style={{ padding: "20px 24px 24px" }}>
      <div className="app-tab-pane is-active"><main><section><QueryProgressOverlay active progress={null} text="查询中" /></section></main></div>
    </div>);
    const overlay = screen.getByRole("status");
    expect(overlay.parentElement).toBe(container.querySelector(".app-tab-pane"));
    expect(overlay.style.getPropertyValue("--query-progress-inset")).toBe("-20px -24px -24px -24px");
  });

  it("covers the current dialog without blocking the page behind it", () => {
    const { container } = render(<div className="app-content"><div className="app-tab-pane is-active">
      <section role="dialog"><div className="dialog-body"><QueryProgressOverlay active progress={50} text="保存中" /></div></section>
    </div></div>);
    expect(screen.getByRole("status").parentElement).toBe(container.querySelector('[role="dialog"]'));
    expect(screen.getByRole("status").style.getPropertyValue("--query-progress-inset")).toBe("0px");
  });
});

it("keeps a scrolled dialog covered and restores scrolling after the task", () => {
  function Dialog({active}: {active:boolean}) {
    return <section role="dialog" style={{overflow:'auto'}}>
      <QueryProgressOverlay active={active} progress={null} text="正在保存" />
    </section>;
  }
  const {rerender} = render(<Dialog active={false} />);
  const dialog = screen.getByRole('dialog');
  dialog.scrollTop = 120;
  rerender(<Dialog active />);
  expect(dialog.style.overflow).toBe('hidden');
  expect(screen.getByRole('status').style.getPropertyValue('--query-progress-inset')).toBe('120px 0px -120px 0px');
  rerender(<Dialog active={false} />);
  expect(dialog.style.overflow).toBe('auto');
});

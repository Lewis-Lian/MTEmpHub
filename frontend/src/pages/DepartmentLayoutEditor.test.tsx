import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DepartmentLayoutEditor from "./DepartmentLayoutEditor";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiRequest: request }));

describe("部门下载排版", () => {
  it("拖动部门可跨栏排序、安置新增部门并保存供下次打开使用", async () => {
    let saved = { left: ["木皮线", "财务部"], right: ["行政部"], unassigned: ["新部门"] };
    request.mockImplementation((_path: string, options?: { method?: string; body?: typeof saved }) => {
      if (options?.method === "PUT") saved = { ...options.body!, unassigned: [] };
      return Promise.resolve(saved);
    });
    const page = render(<DepartmentLayoutEditor rechargeMonth="2026-09" />);
    fireEvent.click(screen.getByText("部门排版设置"));
    await screen.findByText("财务部");
    expect(screen.getByText("2026年8月份菜票登记")).toBeInTheDocument();
    const transfer = { setData: vi.fn(), getData: () => "财务部", effectAllowed: "move" };
    fireEvent.dragStart(screen.getByText("财务部").closest("tr")!, { dataTransfer: transfer });
    fireEvent.drop(screen.getByText("行政部").closest("tr")!, { dataTransfer: transfer });
    expect(within(screen.getByRole("table", { name: "右侧部门" })).getAllByRole("row")[1]).toHaveTextContent("财务部");
    fireEvent.keyDown(screen.getByText("新部门"), { key: "ArrowLeft" });
    expect(within(screen.getByRole("table", { name: "左侧部门" })).getByText("新部门")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存排版" }));
    await screen.findByRole("status");
    page.unmount();
    render(<DepartmentLayoutEditor rechargeMonth="2026-09" />);
    fireEvent.click(screen.getByText("部门排版设置"));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "左侧部门" })).getByText("新部门")).toBeInTheDocument());
    expect(within(screen.getByRole("table", { name: "右侧部门" })).getAllByRole("row")[1]).toHaveTextContent("财务部");
  });

  it("保存失败保留当前排版并显示错误", async () => {
    request.mockImplementation((_path: string, options?: { method?: string }) => options?.method === "PUT"
      ? Promise.reject(new Error("保存失败"))
      : Promise.resolve({ left: ["木皮线"], right: [], unassigned: [] }));
    render(<DepartmentLayoutEditor rechargeMonth="2026-01" />);
    fireEvent.click(screen.getByText("部门排版设置"));
    await screen.findByText("木皮线");
    expect(screen.getByText("2025年12月份菜票登记")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText("木皮线").closest("tr")!, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "保存排版" }));
    await screen.findByRole("alert");
    expect(within(screen.getByRole("table", { name: "右侧部门" })).getByText("木皮线")).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MultiSelectDropdown from "./MultiSelectDropdown";

const OPTIONS = [
  { key: "show_emp_no", label: "显示员工编号" },
  { key: "show_days", label: "显示实际出勤天数" },
  { key: "show_overtime", label: "显示加班变化" },
];

function renderDropdown(value: Record<string, boolean>, onChange = vi.fn()) {
  render(<MultiSelectDropdown onChange={onChange} options={OPTIONS} value={value} />);
  return onChange;
}

afterEach(() => {
  cleanup();
});

describe("MultiSelectDropdown", () => {
  it("未选择时触发按钮显示占位文案，选项列表默认收起", () => {
    renderDropdown({});
    const trigger = screen.getByRole("button", { name: /未选择/ });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("部分选择时按钮摘要显示已选标签，超过两项时折叠计数", () => {
    renderDropdown({ show_emp_no: true, show_days: true });
    expect(screen.getByRole("button", { name: /显示员工编号、显示实际出勤天数/ })).toBeInTheDocument();

    cleanup();
    renderDropdown({ show_emp_no: true, show_days: true, show_overtime: true });
    expect(screen.getByRole("button", { name: /全部/ })).toBeInTheDocument();
  });

  it("点击展开后勾选选项，回调携带正确的新选中状态", () => {
    const onChange = renderDropdown({ show_emp_no: true });
    fireEvent.click(screen.getByRole("button", { name: /显示员工编号/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示实际出勤天数" }));
    expect(onChange).toHaveBeenCalledWith({ show_emp_no: true, show_days: true });
  });

  it("勾选已选项则取消该选项", () => {
    const onChange = renderDropdown({ show_emp_no: true, show_days: true });
    fireEvent.click(screen.getByRole("button", { name: /、/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示员工编号" }));
    expect(onChange).toHaveBeenCalledWith({ show_emp_no: false, show_days: true });
  });

  it("提供全选与清空快捷操作", () => {
    const onChange = renderDropdown({ show_emp_no: true });
    fireEvent.click(screen.getByRole("button", { name: /显示员工编号/ }));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(onChange).toHaveBeenLastCalledWith({
      show_emp_no: true, show_days: true, show_overtime: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(onChange).toHaveBeenLastCalledWith({
      show_emp_no: false, show_days: false, show_overtime: false,
    });
  });

  it("点击组件外部时收起选项列表", async () => {
    renderDropdown({});
    fireEvent.click(screen.getByRole("button", { name: /未选择/ }));
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  });

  it("按 Esc 收起选项列表", async () => {
    renderDropdown({});
    fireEvent.click(screen.getByRole("button", { name: /未选择/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  });

  it("按 Escape 关闭面板后，面板经退场动画从 DOM 移除", async () => {
    renderDropdown({});
    fireEvent.click(screen.getByRole("button", { name: /未选择/ }));
    expect(screen.getByRole("group")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
  });
});

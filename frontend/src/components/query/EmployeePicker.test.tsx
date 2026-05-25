import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmployeePicker from "./EmployeePicker";

const EMPLOYEES = [
  { id: 1, emp_no: "E001", name: "员工甲", dept_id: 11, dept_name: "制造一部", is_manager: false },
  { id: 2, emp_no: "E002", name: "员工乙", dept_id: 11, dept_name: "制造一部", is_manager: false },
  { id: 3, emp_no: "M001", name: "经理甲", dept_id: 20, dept_name: "信息部", is_manager: true },
];

const DEPARTMENTS = [
  { id: 10, dept_no: "D10", dept_name: "制造中心", parent_id: null },
  { id: 11, dept_no: "D11", dept_name: "制造一部", parent_id: 10 },
  { id: 20, dept_no: "D20", dept_name: "信息部", parent_id: null },
];

afterEach(() => {
  cleanup();
});

describe("EmployeePicker", () => {
  it("点击确定前不会提交，点击确定后才会回写选中结果", () => {
    const onChange = vi.fn();

    render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[1]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));
    fireEvent.click(screen.getByLabelText("E002 - 员工乙"));

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it("入口为输入框加右侧选择按钮，并按旧版摘要显示已选员工", () => {
    const onChange = vi.fn();

    render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[1, 2]}
      />,
    );

    const input = screen.getByPlaceholderText("搜索员工编号/姓名") as HTMLInputElement;
    expect(input.value).toBe("员工甲，员工乙");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "M001" } });

    expect(screen.getByText("全选当前列表")).toBeInTheDocument();
    expect(screen.getByText("M001 - 经理甲")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择员工" }));

    expect(screen.getByRole("dialog", { name: "选择员工" })).toBeInTheDocument();
  });

  it("取消会丢弃草稿选择", () => {
    const onChange = vi.fn();

    render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择员工" }));
    fireEvent.click(screen.getByLabelText("E001 - 员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("支持按部门过滤、搜索、全选当前可见项和清空", () => {
    const onChange = vi.fn();

    render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));
    fireEvent.click(screen.getByRole("button", { name: "展开 制造中心" }));
    fireEvent.click(screen.getByRole("button", { name: "制造一部" }));
    fireEvent.change(screen.getAllByPlaceholderText("搜索员工编号/姓名")[1], {
      target: { value: "员工" },
    });
    fireEvent.click(screen.getByLabelText("全选"));

    const selectedPanel = screen.getByRole("region", { name: "已选人员" });
    expect(within(selectedPanel).getByText("员工甲")).toBeInTheDocument();
    expect(within(selectedPanel).getByText("员工乙")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));

    expect(within(selectedPanel).queryByText("员工甲")).toBeNull();
  });

  it("弹窗布局为左侧上下分区、右侧已选员工", () => {
    const onChange = vi.fn();

    const { container } = render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));

    const leftColumn = container.querySelector(".col-lg-7");
    const rightColumn = container.querySelector(".col-lg-5");

    expect(leftColumn).not.toBeNull();
    expect(rightColumn).not.toBeNull();
    expect(leftColumn?.querySelector(".employee-picker-tree")).not.toBeNull();
    expect(leftColumn?.querySelector(".employee-picker-candidates")).not.toBeNull();
    expect(rightColumn?.querySelector(".employee-picker-selected-wrap")).not.toBeNull();
  });

  it("候选、已选和快速列表按旧版结构渲染", () => {
    const onChange = vi.fn();

    const { container } = render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[2, 1]}
      />,
    );

    const input = screen.getByPlaceholderText("搜索员工编号/姓名");
    fireEvent.focus(input);

    const quickList = container.querySelector(".employee-float-list");
    expect(quickList?.classList.contains("show")).toBe(true);
    expect(quickList?.querySelector(".quick-employee-select-all .quick-option-count")?.textContent).toBe("2/3");
    expect(quickList?.querySelector(".quick-employee-option .quick-option-label")?.textContent).toBe("E001 - 员工甲");

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));

    const candidateRows = container.querySelectorAll(".employee-picker-list .employee-picker-row");
    expect(candidateRows).toHaveLength(3);
    expect(candidateRows[0]?.querySelector(".employee-picker-main")?.textContent).toBe("E001 - 员工甲");
    expect(candidateRows[0]?.querySelector(".employee-picker-item")).not.toBeNull();

    const selectedRows = container.querySelectorAll(".employee-selected-list .employee-selected-row");
    expect(selectedRows).toHaveLength(2);
    expect(selectedRows[0]?.querySelector(".employee-selected-main")?.textContent).toBe("员工甲");
    expect(selectedRows[0]?.querySelector(".employee-selected-sub")?.textContent).toBe("制造一部");
    expect(selectedRows[1]?.querySelector(".employee-selected-main")?.textContent).toBe("员工乙");
  });

  it("部门树支持父子层级和展开收起", () => {
    const onChange = vi.fn();

    render(
      <EmployeePicker
        departments={DEPARTMENTS}
        employees={EMPLOYEES}
        onChange={onChange}
        selectedIds={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));

    expect(screen.getByRole("button", { name: "制造中心" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "制造一部" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开 制造中心" }));

    expect(screen.getByRole("button", { name: "制造一部" })).toBeInTheDocument();
  });
});

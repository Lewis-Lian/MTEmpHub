# Query Employee Picker Legacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 React 查询相关页面的简化员工多选框替换为旧版三栏弹窗员工选择器，并保持现有查询参数与页面业务逻辑不变。

**Architecture:** 保留 `EmployeePicker` 对外受控接口，在组件内部引入弹窗草稿状态、部门过滤和已选列表，使用本地派生数据复刻旧版三栏选择流程。页面层只继续传递 `employees`、`selectedIds` 和 `onChange`，样式统一追加到旧版主题 CSS 中。

**Tech Stack:** React 18、TypeScript、React Testing Library、Vitest、现有 `legacy-ui.css`

---

## File Structure

- Modify: `frontend/src/components/query/EmployeePicker.tsx`
  - 将当前内联多选框改为“触发器 + 三栏弹窗”组件，保留现有 props。
- Modify: `frontend/src/styles/legacy-ui.css`
  - 添加员工选择器弹窗、部门树、候选列表、已选列表及触发器样式。
- Modify: `frontend/src/App.smoke.test.tsx`
  - 增加至少一条页面级回归测试，确认查询页渲染的是弹窗入口而不是原多选框。
- Create: `frontend/src/components/query/EmployeePicker.test.tsx`
  - 组件级行为测试，覆盖打开、取消、确定、搜索、部门过滤、全选、清空和已选回显。
- Check only: `frontend/src/pages/query/QueryPage.tsx`
  - 确认现有接入无需改接口。
- Check only: `frontend/src/pages/query/SummaryDownloadPage.tsx`
  - 确认现有接入无需改接口。
- Check only: `frontend/src/pages/admin/ManagerAttendanceOverridesPage.tsx`
  - 确认现有接入无需改接口。

## Task 1: 建立组件级失败测试

**Files:**
- Create: `frontend/src/components/query/EmployeePicker.test.tsx`
- Check: `frontend/src/components/query/EmployeePicker.tsx`

- [ ] **Step 1: 写失败测试，描述旧版弹窗选择器的关键行为**

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EmployeePicker from "./EmployeePicker";

const EMPLOYEES = [
  { id: 1, emp_no: "E001", name: "员工甲", dept_id: 10, dept_name: "制造一部", is_manager: false },
  { id: 2, emp_no: "E002", name: "员工乙", dept_id: 10, dept_name: "制造一部", is_manager: false },
  { id: 3, emp_no: "M001", name: "经理甲", dept_id: 20, dept_name: "信息部", is_manager: true },
];

describe("EmployeePicker", () => {
  it("点击确定前不会提交，点击确定后才会回写选中结果", () => {
    const onChange = vi.fn();

    render(<EmployeePicker employees={EMPLOYEES} onChange={onChange} selectedIds={[1]} />);

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));
    fireEvent.click(screen.getByLabelText("E002 - 员工乙"));

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it("取消会丢弃草稿选择", () => {
    const onChange = vi.fn();

    render(<EmployeePicker employees={EMPLOYEES} onChange={onChange} selectedIds={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));
    fireEvent.click(screen.getByLabelText("E001 - 员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("支持按部门过滤、搜索、全选当前可见项和清空", () => {
    const onChange = vi.fn();

    render(<EmployeePicker employees={EMPLOYEES} onChange={onChange} selectedIds={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /选择员工/i }));
    fireEvent.click(screen.getByRole("button", { name: "制造一部" }));
    fireEvent.change(screen.getByPlaceholderText("搜索工号、姓名或部门"), {
      target: { value: "员工" },
    });
    fireEvent.click(screen.getByLabelText("全选当前可见员工"));

    const selectedPanel = screen.getByRole("region", { name: "已选人员" });
    expect(within(selectedPanel).getByText("E001 - 员工甲")).toBeInTheDocument();
    expect(within(selectedPanel).getByText("E002 - 员工乙")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(within(selectedPanel).queryByText("E001 - 员工甲")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行组件测试，确认当前实现失败**

Run: `npm test -- --run src/components/query/EmployeePicker.test.tsx`

Expected: FAIL，至少出现“找不到选择员工按钮 / 找不到确定按钮 / 找不到清空按钮”一类失败，因为当前组件还是多选下拉框。

- [ ] **Step 3: 提交失败测试**

```bash
git add frontend/src/components/query/EmployeePicker.test.tsx
git commit -m "test: define legacy employee picker behavior"
```

## Task 2: 实现 React 版旧式员工选择器

**Files:**
- Modify: `frontend/src/components/query/EmployeePicker.tsx`
- Modify: `frontend/src/styles/legacy-ui.css`
- Test: `frontend/src/components/query/EmployeePicker.test.tsx`

- [ ] **Step 1: 在组件中引入弹窗状态、草稿选择和派生过滤数据**

```tsx
const [isOpen, setIsOpen] = useState(false);
const [draftSelectedIds, setDraftSelectedIds] = useState<number[]>([]);
const [keyword, setKeyword] = useState("");
const [activeDeptId, setActiveDeptId] = useState<number | "all">("all");

function openPicker() {
  setDraftSelectedIds(selectedIds);
  setKeyword("");
  setActiveDeptId("all");
  setIsOpen(true);
}

function closePicker() {
  setIsOpen(false);
}

function confirmPicker() {
  onChange(draftSelectedIds);
  setIsOpen(false);
}
```

- [ ] **Step 2: 用最小本地派生数据构建部门列表和候选员工列表**

```tsx
const filteredEmployees = useMemo(() => {
  const normalizedKeyword = deferredKeyword.trim().toLowerCase();
  return employees.filter((employee) => {
    if (filterMode === "manager" && !employee.is_manager) return false;
    if (filterMode === "employee" && employee.is_manager) return false;
    if (activeDeptId !== "all" && employee.dept_id !== activeDeptId) return false;
    if (!normalizedKeyword) return true;

    return [
      employee.emp_no,
      employee.name,
      employee.dept_name || "未分配部门",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedKeyword);
  });
}, [activeDeptId, deferredKeyword, employees, filterMode]);

const deptOptions = useMemo(() => {
  const map = new Map<number, string>();
  employees.forEach((employee) => {
    if (employee.dept_id && employee.dept_name) {
      map.set(employee.dept_id, employee.dept_name);
    }
  });
  return [{ id: "all" as const, label: "全部部门" }, ...Array.from(map, ([id, label]) => ({ id, label }))];
}, [employees]);
```

- [ ] **Step 3: 把当前多选下拉框替换成旧版三栏弹窗结构**

```tsx
return (
  <div className="legacy-field">
    <span className="legacy-field-label">{label}</span>
    <button className="legacy-employee-picker-trigger" onClick={openPicker} type="button">
      {selectedIds.length ? `已选 ${selectedIds.length} 人` : "选择员工"}
    </button>
    <span className="legacy-field-hint">{summaryText}</span>

    {isOpen ? (
      <div className="legacy-picker-modal" role="dialog" aria-modal="true" aria-label="选择员工">
        <div className="legacy-picker-dialog">
          <div className="legacy-picker-grid">
            <section aria-label="部门树">{/* dept buttons */}</section>
            <section aria-label="候选员工">{/* search + select visible + candidate rows */}</section>
            <section aria-label="已选人员">{/* selected rows + clear */}</section>
          </div>
          <div className="legacy-picker-actions">
            <button onClick={closePicker} type="button">取消</button>
            <button onClick={confirmPicker} type="button">确定</button>
          </div>
        </div>
      </div>
    ) : null}
  </div>
);
```

- [ ] **Step 4: 为弹窗三栏结构补充最小样式**

```css
.legacy-employee-picker-trigger {
  min-height: 38px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #c7d2de;
  background: #fff;
  color: #183153;
  text-align: left;
}

.legacy-picker-modal {
  position: fixed;
  inset: 0;
  background: rgba(24, 49, 83, 0.18);
  display: grid;
  place-items: center;
  padding: 24px;
}

.legacy-picker-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 280px;
  gap: 16px;
}
```

- [ ] **Step 5: 运行组件测试，确认通过**

Run: `npm test -- --run src/components/query/EmployeePicker.test.tsx`

Expected: PASS

- [ ] **Step 6: 提交组件实现**

```bash
git add frontend/src/components/query/EmployeePicker.tsx frontend/src/styles/legacy-ui.css frontend/src/components/query/EmployeePicker.test.tsx
git commit -m "feat: restore legacy employee picker modal"
```

## Task 3: 补页面级回归测试并确认接入页面不回归

**Files:**
- Modify: `frontend/src/App.smoke.test.tsx`
- Check: `frontend/src/pages/query/QueryPage.tsx`
- Check: `frontend/src/pages/query/SummaryDownloadPage.tsx`
- Check: `frontend/src/pages/admin/ManagerAttendanceOverridesPage.tsx`

- [ ] **Step 1: 给 smoke 测试补一条页面级断言，确认不再渲染原多选框**

```tsx
it("查询页会渲染旧版员工选择器触发器", async () => {
  window.history.replaceState({}, "", "/employee/home");
  fetchMock.mockImplementation((input) => mockEmployeeAppResponse(normalizePath(input)));

  const { default: App } = await import("./App");
  render(<App />);

  await screen.findByRole("heading", { name: "管理人员首页概览" });
  expect(await screen.findAllByRole("button", { name: /选择员工|已选 \d+ 人/ })).not.toHaveLength(0);
  expect(screen.queryByRole("listbox")).toBeNull();
});
```

- [ ] **Step 2: 运行这条 smoke 测试，确认当前页面接入正确**

Run: `npm test -- --run src/App.smoke.test.tsx -t "查询页会渲染旧版员工选择器触发器"`

Expected: PASS

- [ ] **Step 3: 检查三个接入页面无需修改接口**

Run: `rg -n "EmployeePicker" src/pages/query/QueryPage.tsx src/pages/query/SummaryDownloadPage.tsx src/pages/admin/ManagerAttendanceOverridesPage.tsx`

Expected: 只看到现有 `employees`、`selectedIds`、`onChange`、`filterMode`、`label` 等调用，不需要额外 props。

- [ ] **Step 4: 提交页面级回归测试**

```bash
git add frontend/src/App.smoke.test.tsx
git commit -m "test: cover legacy employee picker entrypoints"
```

## Task 4: 完整验证

**Files:**
- Check: `frontend/src/components/query/EmployeePicker.tsx`
- Check: `frontend/src/styles/legacy-ui.css`
- Check: `frontend/src/components/query/EmployeePicker.test.tsx`
- Check: `frontend/src/App.smoke.test.tsx`

- [ ] **Step 1: 运行组件测试和页面 smoke 测试**

Run: `npm test -- --run src/components/query/EmployeePicker.test.tsx src/App.smoke.test.tsx`

Expected: PASS，组件行为和页面挂载都通过。

- [ ] **Step 2: 运行前端构建，确认类型与打包无误**

Run: `npm run build`

Expected: PASS，输出 `built in ...`。

- [ ] **Step 3: 人工检查三类页面入口**

Run: `npm run dev -- --host 127.0.0.1 --port 4173`

Expected: 本地可打开查询中心、汇总下载、管理人员考勤修正页面，触发器、弹窗、确认与取消行为正常。

- [ ] **Step 4: 提交最终验证结果**

```bash
git add frontend/src/components/query/EmployeePicker.tsx frontend/src/styles/legacy-ui.css frontend/src/components/query/EmployeePicker.test.tsx frontend/src/App.smoke.test.tsx
git commit -m "feat: restore legacy query employee picker"
```

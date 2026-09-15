import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QueryEmptyState, {
  AbnormalAlertIcon,
  DepartmentHoursIcon,
  IndividualAttendanceIcon,
  ManagerAnnualLeaveIcon,
  ManagerDepartmentHoursIcon,
  ManagerOvertimeIcon,
  ManagerQueryIcon,
  PunchRecordIcon,
  TeamDashboardIcon,
} from "./QueryEmptyState";

describe("QueryEmptyState", () => {
  it("正确渲染标题、说明文案及默认图标", () => {
    const { container } = render(
      <QueryEmptyState
        description="在上方选择查询条件并点击查询，即可开启数据分析。"
        title="请选择人员后点击查询"
      />,
    );

    expect(screen.getByText("请选择人员后点击查询")).toBeInTheDocument();
    expect(screen.getByText("在上方选择查询条件并点击查询，即可开启数据分析。")).toBeInTheDocument();
    expect(container.querySelector(".query-empty-state")).toBeInTheDocument();
    expect(container.querySelector(".empty-visual-badge svg")).toBeInTheDocument();
  });

  it("支持自定义图标与扩展类名", () => {
    const { container } = render(
      <QueryEmptyState
        className="custom-empty-class"
        description="自定义测试描述"
        icon={<span data-testid="custom-icon">ICON</span>}
        title="自定义测试标题"
      />,
    );

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    expect(container.querySelector(".custom-empty-class")).toBeInTheDocument();
  });

  it("各业务语义矢量图标正常渲染", () => {
    const { container } = render(
      <div>
        <IndividualAttendanceIcon />
        <TeamDashboardIcon />
        <AbnormalAlertIcon />
        <PunchRecordIcon />
        <DepartmentHoursIcon />
        <ManagerQueryIcon />
        <ManagerOvertimeIcon />
        <ManagerAnnualLeaveIcon />
        <ManagerDepartmentHoursIcon />
      </div>,
    );

    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(9);
  });
});

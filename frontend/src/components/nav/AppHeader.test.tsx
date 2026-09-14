import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AppHeader from "./AppHeader";
import { NotificationProvider } from "../feedback/Notification";
import type { AuthUser } from "../../api/auth";

vi.mock("./MessageCenter", () => ({
  default: () => <div data-testid="mock-message-center">消息中心</div>,
}));

const mockUser: AuthUser = {
  id: 1,
  username: "zhangsan",
  role: "admin",
  profile_name: "张三",
  profile_emp_no: "E001",
  dept_name: "研发部",
  avatar: "default:2",
};

function renderAppHeader(props = {}) {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <AppHeader
          currentEntry={null}
          currentModule={null}
          onLogout={vi.fn()}
          onRefreshCurrent={vi.fn()}
          user={mockUser}
          {...props}
        />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

describe("AppHeader Avatar Menu & Modal", () => {
  it("renders user avatar button in header", () => {
    renderAppHeader();
    const avatarBtn = screen.getByRole("button", { name: "用户头像：zhangsan" });
    expect(avatarBtn).toBeInTheDocument();
  });

  it("opens user menu on avatar button click", () => {
    renderAppHeader();
    const avatarBtn = screen.getByRole("button", { name: "用户头像：zhangsan" });

    act(() => {
      fireEvent.click(avatarBtn);
    });

    expect(screen.getByText("工号：")).toBeInTheDocument();
    expect(screen.getByText("E001")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("修改密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /修改头像/ })).toBeInTheDocument();
  });

  it("opens avatar modal when clicking '修改头像' action button", () => {
    renderAppHeader();
    const avatarBtn = screen.getByRole("button", { name: "用户头像：zhangsan" });

    act(() => {
      fireEvent.click(avatarBtn);
    });

    const changeAvatarBtn = screen.getByRole("button", { name: /修改头像/ });
    act(() => {
      fireEvent.click(changeAvatarBtn);
    });

    expect(screen.getByRole("heading", { name: "修改用户头像" })).toBeInTheDocument();
  });

  it("opens avatar modal when clicking the avatar image in user card", () => {
    renderAppHeader();
    const avatarBtn = screen.getByRole("button", { name: "用户头像：zhangsan" });

    act(() => {
      fireEvent.click(avatarBtn);
    });

    const cardAvatar = screen.getByTitle("点击更换头像");
    act(() => {
      fireEvent.click(cardAvatar);
    });

    expect(screen.getByRole("heading", { name: "修改用户头像" })).toBeInTheDocument();
  });
});

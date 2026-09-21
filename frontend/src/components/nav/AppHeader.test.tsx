import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  } as unknown as Response;
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input, "http://localhost").pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, "http://localhost").pathname;
}

// 弹框里的滑块组件默认折叠，需先点开再拖动完成验证。
async function completeSliderCaptcha() {
  fireEvent.click(await screen.findByRole("button", { name: "点击进行安全验证" }));
  await screen.findByAltText("验证码背景");
  const sliderHandle = screen.getByRole("button", { name: "拖动滑块" });
  fireEvent.pointerDown(sliderHandle, { clientX: 10, pointerId: 1 });
  fireEvent.pointerMove(sliderHandle, { clientX: 160, pointerId: 1 });
  fireEvent.pointerUp(sliderHandle, { clientX: 160, pointerId: 1 });
  await screen.findByText("验证通过");
}

describe("AppHeader 修改密码弹框", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockSliderEndpoints(extra?: (path: string) => Response | null) {
    fetchMock.mockImplementation((input) => {
      const path = requestPath(input);
      if (path === "/api/auth/captcha/slider") {
        return Promise.resolve(
          jsonResponse({
            challenge_id: "test-challenge",
            token: "test-slider-token",
            background: "data:image/png;base64,iVBORw0KGgo=",
            slider: "data:image/png;base64,iVBORw0KGgo=",
            slider_width: 44,
          }),
        );
      }
      if (path === "/api/auth/captcha/slider/verify") {
        return Promise.resolve(jsonResponse({ verified_token: "test-verified-token" }));
      }
      const extraResponse = extra?.(path);
      if (extraResponse) {
        return Promise.resolve(extraResponse);
      }
      throw new Error(`unexpected request: ${path}`);
    });
  }

  async function openChangePasswordModal() {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "用户头像：zhangsan" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));
    });
    await screen.findByRole("dialog", { name: "修改密码" });
  }

  it("点击修改密码打开弹框并预填当前账号", async () => {
    mockSliderEndpoints();
    renderAppHeader();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "用户头像：zhangsan" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));
    });

    expect(screen.getByRole("dialog", { name: "修改密码" })).toBeInTheDocument();
    // 菜单随弹框打开而收起（菜单为 CSS 类切换挂载，不卸载）
    const userMenu = document.querySelector(".app-header-user-menu") as HTMLElement;
    expect(userMenu.className).not.toContain("is-open");
    // 账号预填当前登录账号且只读
    const usernameInput = screen.getByLabelText("账号") as HTMLInputElement;
    expect(usernameInput.value).toBe("zhangsan");
    expect(usernameInput.readOnly).toBe(true);
    expect(screen.getByLabelText("原密码")).toBeInTheDocument();
    expect(screen.getByLabelText("新密码")).toBeInTheDocument();
    expect(screen.getByLabelText("确认新密码")).toBeInTheDocument();
  });

  it("提交修改密码成功后在弹框内展示成功提示", async () => {
    let changePasswordBody: unknown = null;
    fetchMock.mockImplementation((input, init) => {
      const path = requestPath(input);
      if (path === "/api/auth/captcha/slider") {
        return Promise.resolve(
          jsonResponse({
            challenge_id: "test-challenge",
            token: "test-slider-token",
            background: "data:image/png;base64,iVBORw0KGgo=",
            slider: "data:image/png;base64,iVBORw0KGgo=",
            slider_width: 44,
          }),
        );
      }
      if (path === "/api/auth/captcha/slider/verify") {
        return Promise.resolve(jsonResponse({ verified_token: "test-verified-token" }));
      }
      if (path === "/api/auth/change-password") {
        changePasswordBody = JSON.parse(String(init?.body));
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected request: ${path}`);
    });

    renderAppHeader();
    await openChangePasswordModal();
    fireEvent.change(screen.getByLabelText("原密码"), { target: { value: "admin123" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
    await completeSliderCaptcha();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect(await screen.findByText("密码修改成功，请使用新密码登录。")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "修改密码" })).toBeInTheDocument();
    expect(changePasswordBody).toEqual({
      username: "zhangsan",
      current_password: "admin123",
      new_password: "newpass123",
      confirm_password: "newpass123",
      captcha_token: "test-verified-token",
    });
  });

  it("修改密码提交返回 403 时提示错误并重置滑块", async () => {
    mockSliderEndpoints((path) => {
      if (path === "/api/auth/change-password") {
        return jsonResponse({ error: "请先完成滑块验证" }, 403);
      }
      return null;
    });

    renderAppHeader();
    await openChangePasswordModal();
    fireEvent.change(screen.getByLabelText("原密码"), { target: { value: "admin123" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
    await completeSliderCaptcha();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先完成滑块验证");
    // 滑块重置后回到待验证的折叠状态，用户可重新拖动
    expect(await screen.findByRole("button", { name: "点击进行安全验证" })).toBeInTheDocument();
  });
});

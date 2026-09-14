import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AvatarChangeModal from "./AvatarChangeModal";
import { NotificationProvider } from "../feedback/Notification";
import type { AuthUser } from "../../api/auth";

const mockUpdateAvatar = vi.fn();
const mockUploadAvatar = vi.fn();

vi.mock("../../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/auth")>();
  return {
    ...actual,
    updateAvatar: (...args: unknown[]) => mockUpdateAvatar(...args),
    uploadAvatar: (...args: unknown[]) => mockUploadAvatar(...args),
  };
});

// Mock URL.createObjectURL and URL.revokeObjectURL
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
globalThis.URL.revokeObjectURL = vi.fn();

const mockUser: AuthUser = {
  id: 1,
  username: "testuser",
  role: "admin",
  profile_name: "测试用户",
  avatar: "default:1",
};

describe("AvatarChangeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderModal(props = {}) {
    return render(
      <NotificationProvider>
        <AvatarChangeModal
          isOpen={true}
          onClose={vi.fn()}
          onUserUpdate={vi.fn()}
          user={mockUser}
          {...props}
        />
      </NotificationProvider>,
    );
  }

  it("does not render when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders modal with default preset avatars grid when opened", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "修改用户头像" })).toBeInTheDocument();
    expect(screen.getByText("精选默认头像")).toBeInTheDocument();
    expect(screen.getByText("经典蓝调")).toBeInTheDocument();
    expect(screen.getByText("活力朝阳")).toBeInTheDocument();
    expect(screen.getByText("清新薄荷")).toBeInTheDocument();
    expect(screen.getByText("极光紫霞")).toBeInTheDocument();
    expect(screen.getByText("极客智蓝")).toBeInTheDocument();
    expect(screen.getByText("热忱珊瑚")).toBeInTheDocument();
  });

  it("allows selecting a different preset avatar and saving", async () => {
    const onUserUpdate = vi.fn();
    const onClose = vi.fn();
    const updatedUser = { ...mockUser, avatar: "default:3" };
    mockUpdateAvatar.mockResolvedValueOnce({ ok: true, avatar: "default:3", user: updatedUser });

    renderModal({ onUserUpdate, onClose });

    // Click on preset 3 ("清新薄荷")
    const presetBtn = screen.getByRole("button", { name: "选择清新薄荷" });
    fireEvent.click(presetBtn);

    // Save
    const saveBtn = screen.getByRole("button", { name: "保存头像" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mockUpdateAvatar).toHaveBeenCalledWith({ avatar: "default:3" });
    await waitFor(() => {
      expect(onUserUpdate).toHaveBeenCalledWith(updatedUser);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("validates file format and size in custom upload tab", async () => {
    renderModal();

    // Switch to custom tab
    fireEvent.click(screen.getByRole("button", { name: /自定义图片上传/ }));
    expect(screen.getByText("点击或将图片拖拽至此处上传")).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    // 1. Invalid file format
    const badFile = new File(["test"], "doc.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [badFile] } });
    });
    expect(screen.getByText("请上传 JPG、PNG、WEBP 或 GIF 格式的图片")).toBeInTheDocument();

    // 2. Oversized file (> 2MB)
    const largeFile = new File([new ArrayBuffer(3 * 1024 * 1024)], "large.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [largeFile] } });
    });
    expect(screen.getByText("图片大小不能超过 2MB，请重新选择")).toBeInTheDocument();
  });

  it("uploads valid custom avatar file on save", async () => {
    const onUserUpdate = vi.fn();
    const onClose = vi.fn();
    const updatedUser = { ...mockUser, avatar: "/api/auth/avatar/avatar_u1_123.png" };
    mockUploadAvatar.mockResolvedValueOnce({
      ok: true,
      avatar: "/api/auth/avatar/avatar_u1_123.png",
      user: updatedUser,
    });

    renderModal({ onUserUpdate, onClose });

    // Switch to custom tab
    fireEvent.click(screen.getByRole("button", { name: /自定义图片上传/ }));

    const validFile = new File(["test-image"], "photo.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validFile] } });
    });

    expect(screen.getByText("photo.png")).toBeInTheDocument();

    // Save
    const saveBtn = screen.getByRole("button", { name: "保存头像" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mockUploadAvatar).toHaveBeenCalledWith(validFile);
    await waitFor(() => {
      expect(onUserUpdate).toHaveBeenCalledWith(updatedUser);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closes modal on cancel button click", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
  });
});

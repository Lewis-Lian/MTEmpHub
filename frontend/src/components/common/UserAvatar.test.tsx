import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UserAvatar, { PRESET_AVATARS } from "./UserAvatar";

describe("UserAvatar", () => {
  it("renders default:1 SVG when avatar is not provided", () => {
    const { container } = render(<UserAvatar name="测试用户" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders all 6 preset avatars by id", () => {
    PRESET_AVATARS.forEach((preset) => {
      const { container } = render(<UserAvatar avatar={preset.id} name={preset.name} />);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });
  });

  it("renders custom image when avatar is a valid URL", () => {
    render(<UserAvatar avatar="/api/auth/avatar/test.png" name="自定义用户" size={40} />);
    const img = screen.getByRole("img", { name: "自定义用户的头像" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/api/auth/avatar/test.png");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "40");
  });

  it("falls back to default SVG if custom image fails to load", () => {
    const { container } = render(<UserAvatar avatar="/api/auth/avatar/broken.png" name="损坏头像" />);
    const img = screen.getByRole("img", { name: "损坏头像的头像" });
    expect(img).toBeInTheDocument();

    // Trigger error
    fireEvent.error(img);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});

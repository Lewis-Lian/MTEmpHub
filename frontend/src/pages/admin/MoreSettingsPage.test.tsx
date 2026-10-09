import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchMoreSettings: vi.fn(), saveMoreSettings: vi.fn() }));
vi.mock("../../api/admin", () => api);
vi.mock("../../components/feedback/Notification", () => ({
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));
import MoreSettingsPage from "./MoreSettingsPage";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  api.fetchMoreSettings.mockResolvedValue({ meal_ticket_abnormal_deduction_enabled: false });
  api.saveMoreSettings.mockImplementation(async enabled => ({ meal_ticket_abnormal_deduction_enabled: enabled }));
});

it("defaults off, persists a toggle and displays the saved state", async () => {
  render(<MoreSettingsPage />);
  const toggle = await screen.findByRole("switch", { name: "异常考勤天数扣除" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(api.saveMoreSettings).toHaveBeenCalledWith(true);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(api.saveMoreSettings).toHaveBeenLastCalledWith(false);
});

it("keeps the saved value when saving fails", async () => {
  api.saveMoreSettings.mockRejectedValue(new Error("保存失败"));
  render(<MoreSettingsPage />);
  const toggle = await screen.findByRole("switch", { name: "异常考勤天数扣除" });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).toHaveAttribute("aria-checked", "false");
});

it("does not offer a toggle when settings cannot be loaded", async () => {
  api.fetchMoreSettings.mockRejectedValue(new Error("无权访问"));
  render(<MoreSettingsPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无权访问");
  expect(screen.queryByRole("switch")).toBeNull();
});

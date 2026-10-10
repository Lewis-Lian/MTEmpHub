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
  api.fetchMoreSettings.mockResolvedValue({ meal_ticket_abnormal_deduction_enabled: false, meal_ticket_offset_enabled: true });
  api.saveMoreSettings.mockImplementation(async patch => ({ meal_ticket_abnormal_deduction_enabled: false, meal_ticket_offset_enabled: true, ...patch }));
});

it("defaults off, persists a toggle and displays the saved state", async () => {
  render(<MoreSettingsPage />);
  const toggle = await screen.findByRole("switch", { name: "异常考勤天数扣除" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(api.saveMoreSettings).toHaveBeenCalledWith({ meal_ticket_abnormal_deduction_enabled: true });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(api.saveMoreSettings).toHaveBeenLastCalledWith({ meal_ticket_abnormal_deduction_enabled: false });
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

it("defaults offset on and independently saves each switch", async () => {
  let saved = { meal_ticket_abnormal_deduction_enabled: false, meal_ticket_offset_enabled: true };
  api.saveMoreSettings.mockImplementation(async patch => { saved = { ...saved, ...patch }; return saved; });
  render(<MoreSettingsPage />);
  const offset = await screen.findByRole("switch", { name: "补发与扣款抵消" });
  const deduction = screen.getByRole("switch", { name: "异常考勤天数扣除" });
  expect(screen.getAllByRole("switch")).toHaveLength(2);
  expect(offset).toHaveAttribute("aria-checked", "true");
  fireEvent.click(offset);
  await waitFor(() => expect(offset).toHaveAttribute("aria-checked", "false"));
  expect(api.saveMoreSettings).toHaveBeenLastCalledWith({ meal_ticket_offset_enabled: false });
  expect(deduction).toHaveAttribute("aria-checked", "false");
  fireEvent.click(deduction);
  await waitFor(() => expect(deduction).toHaveAttribute("aria-checked", "true"));
  expect(offset).toHaveAttribute("aria-checked", "false");
  fireEvent.click(offset);
  await waitFor(() => expect(offset).toHaveAttribute("aria-checked", "true"));
  expect(deduction).toHaveAttribute("aria-checked", "true");
});

it("prevents overlapping saves and keeps both saved values on failure", async () => {
  let rejectSave!: (error: Error) => void;
  api.saveMoreSettings.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
  render(<MoreSettingsPage />);
  const offset = await screen.findByRole("switch", { name: "补发与扣款抵消" });
  const deduction = screen.getByRole("switch", { name: "异常考勤天数扣除" });
  fireEvent.click(offset);
  expect(offset).toBeDisabled();
  expect(offset).toHaveTextContent("保存中");
  expect(deduction).toBeDisabled();
  fireEvent.click(offset);
  fireEvent.click(deduction);
  expect(api.saveMoreSettings).toHaveBeenCalledTimes(1);
  rejectSave(new Error("保存失败"));
  await waitFor(() => expect(offset).not.toBeDisabled());
  expect(offset).toHaveAttribute("aria-checked", "true");
  expect(deduction).toHaveAttribute("aria-checked", "false");
});

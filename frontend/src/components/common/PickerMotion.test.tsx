import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MonthPicker from "./MonthPicker";
import YearPicker from "./YearPicker";
import TimePicker from "./TimePicker";

afterEach(() => cleanup());

describe("Picker 弹层进出场", () => {
  it("MonthPicker 打开出现月份格，点击外部收起后经退场移除", async () => {
    render(<MonthPicker onChange={vi.fn()} value="" />);
    fireEvent.click(screen.getByPlaceholderText("选择月份"));
    expect(await screen.findByText("1月")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText("1月")).toBeNull());
  });

  it("YearPicker 打开出现年份区间，收起后经退场移除", async () => {
    render(<YearPicker onChange={vi.fn()} value="" />);
    fireEvent.click(screen.getByRole("textbox"));
    expect(await screen.findByText(/20\d{2} - 20\d{2}/)).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText(/20\d{2} - 20\d{2}/)).toBeNull());
  });

  it("TimePicker 打开出现时列，收起后经退场移除", async () => {
    render(<TimePicker onChange={vi.fn()} value="08:30" />);
    fireEvent.click(screen.getByDisplayValue("08:30"));
    expect(await screen.findAllByRole("list")).not.toHaveLength(0);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryAllByRole("list")).toHaveLength(0));
  });
});

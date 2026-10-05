import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

const { Input } = defaultPrimitives;

const PLANS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro", description: "ab Starter", disabled: true },
  { value: "max", label: "Max", description: "ab Business", disabled: true },
] as const;

describe("select primitive with disabled options", () => {
  test("dropdown appends the hint to the label and does not pick a disabled option", async () => {
    const picked: string[] = [];
    render(
      <Input
        kind="select"
        id="plan"
        name="plan"
        value="free"
        onChange={(v) => picked.push(v)}
        options={PLANS}
        display="dropdown"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("combobox-plan"));
    });
    const disabledOption = await screen.findByTestId("combobox-plan-option-pro");
    expect(disabledOption.textContent).toContain("Pro (ab Starter)");
    expect(disabledOption.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(disabledOption);
    });
    expect(picked).toEqual([]);
  });

  test("radio list disables the input and shows the hint as description", () => {
    const picked: string[] = [];
    render(
      <Input
        kind="select"
        id="plan"
        name="plan"
        value="free"
        onChange={(v) => picked.push(v)}
        options={PLANS}
        display="radio"
      />,
    );
    const pro = screen.getByTestId("radio-list-plan-pro") as HTMLInputElement;
    expect(pro.disabled).toBe(true);
    expect(screen.getByText("ab Starter")).toBeTruthy();
    fireEvent.click(pro);
    expect(picked).toEqual([]);
    const free = screen.getByTestId("radio-list-plan-free") as HTMLInputElement;
    expect(free.disabled).toBe(false);
  });

  test("radio cards disable the input too", () => {
    render(
      <Input
        kind="select"
        id="plan"
        name="plan"
        value="free"
        onChange={() => {}}
        options={PLANS}
        radioVariant="card"
      />,
    );
    expect((screen.getByTestId("radio-list-plan-max") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("ab Business")).toBeTruthy();
  });

  test("segmented control disables the segment and arrow keys skip it", () => {
    const picked: string[] = [];
    render(
      <Input
        kind="select"
        id="plan"
        name="plan"
        value="free"
        onChange={(v) => picked.push(v)}
        options={[
          { value: "free", label: "Free" },
          { value: "pro", label: "Pro", disabled: true },
          { value: "max", label: "Max" },
        ]}
        display="radio"
      />,
    );
    const pro = screen.getByTestId("segmented-plan-pro") as HTMLButtonElement;
    expect(pro.disabled).toBe(true);
    fireEvent.click(pro);
    expect(picked).toEqual([]);
    fireEvent.keyDown(screen.getByTestId("segmented-plan-free"), { key: "ArrowRight" });
    expect(picked).toEqual(["max"]);
  });
});

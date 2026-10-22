import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { defaultPrimitives } from "../index.tsx";

const { Input } = defaultPrimitives;

function ControlledCodeInput({
  onComplete,
  autoFocus,
}: {
  readonly onComplete: (code: string) => void;
  readonly autoFocus?: boolean;
}): ReactNode {
  const [value, setValue] = useState("");
  return (
    <Input
      kind="code"
      id="code"
      name="code"
      length={6}
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      testId="code"
      {...(autoFocus !== undefined && { autoFocus })}
    />
  );
}

function type(value: string): void {
  fireEvent.change(screen.getByTestId("code"), { target: { value } });
}

function activeCellIndex(): number {
  const cells = Array.from(document.querySelectorAll("[data-active]"));
  return cells.findIndex((cell) => cell.getAttribute("data-active") === "true");
}

describe("DefaultInput kind=code", () => {
  test("pasted '123 456' becomes 123456 and completes once", () => {
    const onComplete = mock((_code: string) => {});
    render(<ControlledCodeInput onComplete={onComplete} />);
    type("123 456");
    expect(screen.getByTestId("code")).toHaveProperty("value", "123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  test("digit by digit completes only on the sixth", () => {
    const onComplete = mock((_code: string) => {});
    render(<ControlledCodeInput onComplete={onComplete} />);
    for (const partial of ["1", "12", "123", "1234", "12345"]) type(partial);
    expect(onComplete).not.toHaveBeenCalled();
    type("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("non-digits are discarded", () => {
    const onComplete = mock((_code: string) => {});
    render(<ControlledCodeInput onComplete={onComplete} />);
    type("a1-b2");
    expect(screen.getByTestId("code")).toHaveProperty("value", "12");
    type("12ab");
    expect(screen.getByTestId("code")).toHaveProperty("value", "12");
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("backspace moves the active cell back", () => {
    render(<ControlledCodeInput onComplete={() => {}} />);
    type("123");
    expect(activeCellIndex()).toBe(3);
    type("12");
    expect(activeCellIndex()).toBe(2);
  });

  test("clearing and completing again fires onComplete again, once", () => {
    const onComplete = mock((_code: string) => {});
    render(<ControlledCodeInput onComplete={onComplete} />);
    type("123456");
    type("");
    type("654321");
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("654321");
  });

  test("autoFocus focuses the input, its absence does not", () => {
    const { unmount } = render(<ControlledCodeInput onComplete={() => {}} autoFocus />);
    expect(document.activeElement).toBe(screen.getByTestId("code"));
    unmount();
    render(<ControlledCodeInput onComplete={() => {}} />);
    expect(document.activeElement).not.toBe(screen.getByTestId("code"));
  });
});

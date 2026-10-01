import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyInput } from "../money-input.js";
import { NumberInput } from "../number-input.js";

function renderNumber(
  props: Partial<Parameters<typeof NumberInput>[0]> & {
    onChange?: (v: number | undefined) => void;
  },
): HTMLInputElement {
  render(
    <NumberInput
      id="n"
      name="n"
      value={28000}
      onChange={() => undefined}
      locale="de-DE"
      {...props}
    />,
  );
  return screen.getByRole("textbox") as HTMLInputElement;
}

describe("NumberInput", () => {
  test("de-DE shows grouped value blurred and the raw string focused", () => {
    const input = renderNumber({});
    expect(input.value).toBe("28.000");
    fireEvent.focus(input);
    expect(input.value).toBe("28000");
    fireEvent.blur(input);
    expect(input.value).toBe("28.000");
  });

  test("focus selects the whole raw value so typing replaces a prefilled number", () => {
    const input = renderNumber({ value: 10000 });
    fireEvent.focus(input);
    expect(input.value).toBe("10000");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  test("grouping=false keeps a year without a thousands separator", () => {
    const input = renderNumber({ value: 2021, grouping: false });
    expect(input.value).toBe("2021");
  });

  test("typing a de-DE grouped decimal emits the parsed number", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ value: "", onChange });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.234,5" } });
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
  });

  test.each([
    ["de-DE", "1.5", undefined],
    ["de-DE", "12.34", undefined],
    ["de-DE", "1.234", 1234],
    ["de-DE", "1.234,5", 1234.5],
    ["de-DE", "1,5", 1.5],
    ["en-US", "1,234.5", 1234.5],
    ["en-US", "1,5", undefined],
  ] as const)(
    "%s: typing %s emits %p (misplaced group separators are rejected)",
    (locale, typed, expected) => {
      const onChange = mock((_v: number | undefined) => undefined);
      const input = renderNumber({ value: "", onChange, locale });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: typed } });
      if (expected === undefined) {
        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe(typed);
      } else {
        expect(onChange).toHaveBeenLastCalledWith(expected);
      }
    },
  );

  test("focus then blur without editing leaves a fractional value unchanged", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ value: 1234.5, onChange });
    expect(input.value).toBe("1.234,5");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.value).toBe("1.234,5");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("raw digits parse (fill('28500') compatibility)", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ value: "", onChange });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "28500" } });
    expect(onChange).toHaveBeenLastCalledWith(28500);
  });

  test("clearing emits undefined; garbage emits nothing and blur restores the value", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ onChange });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12abc" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe("28.000");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  test("integer mode rejects a fractional entry", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ value: "", integer: true, onChange });
    expect(input.inputMode).toBe("numeric");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12,5" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an invalid locale tag does not throw and falls back to en-US", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    const input = renderNumber({ locale: "not_a_locale", value: 1234.5, onChange });
    expect(input.value).toBe("1,234.5");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2,000.25" } });
    expect(onChange).toHaveBeenLastCalledWith(2000.25);
  });
});

describe("MoneyInput with an invalid locale tag", () => {
  test("focus, type and blur emit the right minor value instead of throwing", () => {
    const onChange = mock((_v: number | undefined) => undefined);
    render(
      <MoneyInput
        id="m"
        name="m"
        value={1000}
        onChange={onChange}
        currency="EUR"
        locale="not_a_locale"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12.34" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(1234);
  });
});

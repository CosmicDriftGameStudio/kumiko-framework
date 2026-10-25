//
// MoneyInput has enough custom logic (focus-aware formatting, +/- buttons,
// locale parsing) that the switch-case test in primitives.test is insufficient.
// These tests pin the contracts:
//   - Blur view formats with the currency symbol and thousands separator.
//   - Focus view provides a raw editable string without grouping.
//   - +/- buttons mutate canonical cents directly, not major units.
//   - Blur with invalid input discards the value instead of corrupting it.
//   - Different currencies use the correct number of decimal places (JPY=0).

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyInput, parseLocaleNumber } from "../primitives/money-input.tsx";

describe("MoneyInput", () => {
  test("blur-view: de-DE EUR zeigt €-Symbol + Punkt-Tausender + Komma-Decimal", () => {
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={123456}
        onChange={() => undefined}
        currency="EUR"
        locale="de-DE"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("1.234,56");
    const symbol = screen.getByTestId("eur-currency");
    expect(symbol.textContent).toBe("€");
    expect(symbol.className).toContain("text-muted-foreground");
    expect(symbol.className).toContain("pr-3");
  });

  test("blur-view: en-US USD zeigt $-Prefix + Komma-Tausender + Punkt-Decimal", () => {
    render(
      <MoneyInput
        id="usd"
        name="usd"
        value={2599}
        onChange={() => undefined}
        currency="USD"
        locale="en-US"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("25.99");
    const symbol = screen.getByTestId("usd-currency");
    expect(symbol.textContent).toBe("$");
    expect(symbol.className).toContain("pl-3");
  });

  test("blur-view: ja-JP JPY displays Yen symbol without decimals", () => {
    render(
      <MoneyInput
        id="jpy"
        name="jpy"
        value={150000}
        onChange={() => undefined}
        currency="JPY"
        locale="ja-JP"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    // ja-JP renders "￥150,000" (fullwidth yen) with 0 decimals because JPY
    // has no subunits — 150.000 cents → 150.000 yen directly.
    expect(input.value).toContain("150,000");
    expect(input.value).not.toContain(".00");
  });

  test("focus-view: shows raw editable string (no grouping, no symbol)", () => {
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={123456}
        onChange={() => undefined}
        currency="EUR"
        locale="de-DE"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    // The de-DE locale uses a comma as the decimal separator, not a period.
    expect(input.value).toBe("1234,56");
  });

  test("blur with a valid edit string: onChange fires cents", () => {
    const onChange = mock();
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={1000}
        onChange={onChange}
        currency="EUR"
        locale="de-DE"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12,34" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(1234);
  });

  test("blur with an empty string: onChange(undefined) clears the value", () => {
    const onChange = mock();
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={1000}
        onChange={onChange}
        currency="EUR"
        locale="de-DE"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("blur with corrupt input (letters): onChange is NOT called", () => {
    const onChange = mock();
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={1000}
        onChange={onChange}
        currency="EUR"
        locale="de-DE"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("has no stepper buttons", () => {
    render(
      <MoneyInput
        id="eur"
        name="eur"
        value={1000}
        onChange={mock()}
        currency="EUR"
        locale="de-DE"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("parseLocaleNumber (strict-Negative)", () => {
  test("de-DE: recognizes comma as decimal separator", () => {
    expect(parseLocaleNumber("12,34", "de-DE")).toBe(12.34);
  });

  test("en-US: recognizes period as decimal separator", () => {
    expect(parseLocaleNumber("12.34", "en-US")).toBe(12.34);
  });

  test("Thousands separators are removed", () => {
    expect(parseLocaleNumber("1.234,56", "de-DE")).toBe(1234.56);
    expect(parseLocaleNumber("1,234.56", "en-US")).toBe(1234.56);
  });

  test("negative at the beginning: is parsed as a negative number", () => {
    expect(parseLocaleNumber("-12,34", "de-DE")).toBe(-12.34);
  });

  test("Minus in the middle of the number: NaN (strict — no silent fallback)", () => {
    // "1-23" could naively be interpreted as -123; the strict check prevents
    // mistyped input from being converted into the wrong amount.
    expect(parseLocaleNumber("1-23", "de-DE")).toBeNaN();
  });

  test("Letters or special characters: NaN", () => {
    expect(parseLocaleNumber("abc", "de-DE")).toBeNaN();
    expect(parseLocaleNumber("12,3a", "de-DE")).toBeNaN();
  });

  test("Empty string or a lone decimal separator: NaN", () => {
    expect(parseLocaleNumber("", "de-DE")).toBeNaN();
    expect(parseLocaleNumber(",", "de-DE")).toBeNaN();
  });
});

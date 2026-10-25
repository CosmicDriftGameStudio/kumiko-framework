// money-input tests.
//
// Tier 1 — Pure logic (currencyDecimals, parseLocaleNumber): exported
//   pure functions that require no DOM.
// Tier 2 — Rendering (happy-dom + @testing-library): money-input is the
//   only non-Radix primitive and is fully testable because it has no
//   pointer-capture issues — format round-trip, +/- bump, and a11y.

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { currencyDecimals, formatMoney, MoneyInput, parseLocaleNumber } from "../money-input.tsx";

describe("formatMoney", () => {
  test("formats a normal amount with the currency symbol", () => {
    expect(formatMoney(199_99, "USD", "en-US")).toBe("$199.99");
  });

  test("falls back to the raw amount instead of throwing on an invalid currency", () => {
    expect(formatMoney(100, "", "en-US")).toBe("100");
    expect(formatMoney(100, "EU", "en-US")).toBe("100");
    expect(formatMoney(100, "€", "en-US")).toBe("100");
  });
});

describe("currencyDecimals", () => {
  test("0-decimal currencies (JPY/KRW/VND/ISK)", () => {
    for (const c of ["JPY", "KRW", "VND", "ISK"]) expect(currencyDecimals(c)).toBe(0);
  });

  test("3-decimal currencies (BHD/JOD/KWD/OMR/TND)", () => {
    for (const c of ["BHD", "JOD", "KWD", "OMR", "TND"]) expect(currencyDecimals(c)).toBe(3);
  });

  test("Defaults to 2 for EUR/USD and unknown codes", () => {
    for (const c of ["EUR", "USD", "CHF", "ZZZ"]) expect(currencyDecimals(c)).toBe(2);
  });
});

describe("parseLocaleNumber", () => {
  test("en-US: Punkt = Decimal, Komma = Gruppierung", () => {
    expect(parseLocaleNumber("1,234.56", "en-US")).toBeCloseTo(1234.56, 5);
  });

  test("de-DE: Komma = Decimal, Punkt = Gruppierung", () => {
    expect(parseLocaleNumber("1.234,56", "de-DE")).toBeCloseTo(1234.56, 5);
  });

  test("a leading minus is allowed", () => {
    expect(parseLocaleNumber("-123", "en-US")).toBe(-123);
  });

  test("Minus only at the very beginning — '1-23' is invalid (NaN)", () => {
    expect(parseLocaleNumber("1-23", "en-US")).toBeNaN();
  });

  test("Letters, empty string, and bare separator → NaN", () => {
    expect(parseLocaleNumber("abc", "en-US")).toBeNaN();
    expect(parseLocaleNumber("", "en-US")).toBeNaN();
    expect(parseLocaleNumber(".", "en-US")).toBeNaN();
  });

  test("surrounding whitespace is trimmed", () => {
    expect(parseLocaleNumber("  42  ", "en-US")).toBe(42);
  });
});

function inputEl(): HTMLInputElement {
  const el = screen.getByRole("textbox");
  if (!(el instanceof HTMLInputElement)) throw new Error("expected an <input> element");
  return el;
}

describe("MoneyInput — Render (Tier 2)", () => {
  test("displays the canonical cent value as formatted currency (unfocused)", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={() => {}}
        currency="EUR"
        locale="de-DE"
      />,
    );
    expect(inputEl().value).toBe("10,00");
    expect(screen.getByTestId("amt-currency").textContent).toBe("€");
    expect(inputEl().getAttribute("aria-describedby")).toBe("amt-currency");
  });

  test("Focus switches to the raw decimal string without a currency symbol", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={() => {}}
        currency="EUR"
        locale="de-DE"
      />,
    );
    fireEvent.focus(inputEl());
    const value = inputEl().value;
    expect(value).toContain("10,00");
    expect(value).not.toContain("€");
  });

  test("Focus selects the entire draft (intentional select-all-on-focus) — otherwise a subsequently inserted value is appended instead of replacing it", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={() => {}}
        currency="EUR"
        locale="de-DE"
      />,
    );
    fireEvent.focus(inputEl());
    const input = inputEl();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  test("Blur with a new value calls onChange with minor units (cents)", () => {
    const onChange = mock((_v: number | undefined) => {});
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={onChange}
        currency="EUR"
        locale="de-DE"
      />,
    );
    fireEvent.focus(inputEl());
    fireEvent.change(inputEl(), { target: { value: "25,50" } });
    fireEvent.blur(inputEl());
    expect(onChange).toHaveBeenCalledWith(2550);
  });

  test("an invalid locale falls back to en-US formatting, with and without a value", () => {
    const { rerender } = render(
      <MoneyInput
        id="amt"
        name="amt"
        value=""
        onChange={() => {}}
        currency="EUR"
        locale="not_a_locale!"
      />,
    );
    expect(inputEl().value).toBe("");
    expect(screen.getByTestId("amt-currency").textContent).toBe("€");
    rerender(
      <MoneyInput
        id="amt"
        name="amt"
        value={1234}
        onChange={() => {}}
        currency="EUR"
        locale="not_a_locale!"
      />,
    );
    expect(inputEl().value).toBe("12.34");
    expect(screen.getByTestId("amt-currency").textContent).toBe("€");
  });

  test("a multi-character symbol takes its own space next to the input instead of overlapping it", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={123456}
        onChange={() => {}}
        currency="CHF"
        locale="de-CH"
      />,
    );
    const symbol = screen.getByTestId("amt-currency");
    expect(symbol.textContent).toBe("CHF");
    expect(symbol.className).not.toContain("absolute");
    expect(symbol.parentElement).toBe(inputEl().parentElement);
    // de-CH puts the symbol first, so the symbol precedes the input.
    expect(symbol.nextElementSibling).toBe(inputEl());
    expect(inputEl().value).toBe("1'234.56");
  });

  test("a suffix symbol follows the input", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={() => {}}
        currency="EUR"
        locale="de-DE"
      />,
    );
    expect(inputEl().nextElementSibling).toBe(screen.getByTestId("amt-currency"));
  });

  test("renders no step buttons", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value={1000}
        onChange={() => {}}
        currency="EUR"
        locale="de-DE"
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("a11y: aria-required + aria-invalid spiegeln die Props", () => {
    render(
      <MoneyInput
        id="amt"
        name="amt"
        value=""
        onChange={() => {}}
        currency="EUR"
        required
        hasError
      />,
    );
    const input = inputEl();
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

// money-input Tests (Phase 1, test-luecken-integration).
//
// Tier 1 — Pure-Logik (currencyDecimals, parseLocaleNumber): exportierte
//   reine Funktionen, kein DOM nötig.
// Tier 2 — Render (happy-dom + @testing-library): money-input ist das
//   einzige nicht-Radix-Primitive, daher voll testbar (kein
//   Pointer-Capture-Problem) — Format-Roundtrip, +/- Bump, a11y.

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { currencyDecimals, MoneyInput, parseLocaleNumber } from "../money-input";

describe("currencyDecimals", () => {
  test("0-Decimal-Währungen (JPY/KRW/VND/ISK)", () => {
    for (const c of ["JPY", "KRW", "VND", "ISK"]) expect(currencyDecimals(c)).toBe(0);
  });

  test("3-Decimal-Währungen (BHD/JOD/KWD/OMR/TND)", () => {
    for (const c of ["BHD", "JOD", "KWD", "OMR", "TND"]) expect(currencyDecimals(c)).toBe(3);
  });

  test("Default 2 für EUR/USD und unbekannte Codes", () => {
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

  test("führendes Minus erlaubt", () => {
    expect(parseLocaleNumber("-123", "en-US")).toBe(-123);
  });

  test("Minus NUR ganz vorne — '1-23' ist invalid (NaN)", () => {
    expect(parseLocaleNumber("1-23", "en-US")).toBeNaN();
  });

  test("Buchstaben, leerer String und nackter Separator → NaN", () => {
    expect(parseLocaleNumber("abc", "en-US")).toBeNaN();
    expect(parseLocaleNumber("", "en-US")).toBeNaN();
    expect(parseLocaleNumber(".", "en-US")).toBeNaN();
  });

  test("umgebender Whitespace wird getrimmt", () => {
    expect(parseLocaleNumber("  42  ", "en-US")).toBe(42);
  });
});

function inputEl(): HTMLInputElement {
  const el = screen.getByRole("textbox");
  if (!(el instanceof HTMLInputElement)) throw new Error("expected an <input> element");
  return el;
}

describe("MoneyInput — Render (Tier 2)", () => {
  test("zeigt den Canonical-Cent-Wert als formatierte Währung (unfokussiert)", () => {
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
    const value = inputEl().value;
    expect(value).toContain("10");
    expect(value).toContain("€");
  });

  test("Focus schaltet auf rohen Decimal-String ohne Währungssymbol", () => {
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

  test("Blur mit neuem Wert ruft onChange mit Minor-Units (Cents)", () => {
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

  test("+/- Buttons bumpen um eine Major-Unit (= factor Cents)", () => {
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
    const [minus, plus] = screen.getAllByRole("button");
    if (minus === undefined || plus === undefined) throw new Error("expected two step buttons");
    fireEvent.click(plus);
    expect(onChange).toHaveBeenLastCalledWith(1100);
    fireEvent.click(minus);
    expect(onChange).toHaveBeenLastCalledWith(900);
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

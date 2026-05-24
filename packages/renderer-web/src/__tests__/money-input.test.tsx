//
// MoneyInput hat genug Custom-Logik (focus-aware Format, +/- Buttons,
// Locale-Parse), dass der Switch-Case-Test in primitives.test nicht
// reicht. Hier pinnen wir die Verträge:
//   - Blur-View formatiert mit Currency-Symbol + Tausender-Trenner.
//   - Focus-View liefert raw editable string, ohne Grouping.
//   - +/- Buttons mutieren Canonical-Cents direkt (nicht major-units).
//   - Blur mit Müll-Input verwirft den Wert (kein corrupt-set).
//   - Verschiedene Currencies → korrekte Decimal-Stellen (JPY=0).

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyInput, parseLocaleNumber } from "../primitives/money-input";

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
    expect(input.value).toBe("1.234,56 €");
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
    expect(input.value).toBe("$25.99");
  });

  test("blur-view: ja-JP JPY zeigt Yen-Symbol ohne Decimals", () => {
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
    // ja-JP rendert "￥150,000" (Fullwidth-Yen). 0 Decimals weil JPY
    // keine Subunits hat — 150.000 cents → 150.000 Yen direkt.
    expect(input.value).toContain("150,000");
    expect(input.value).not.toContain(".00");
  });

  test("focus-view: zeigt raw editable string (kein Grouping, kein Symbol)", () => {
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
    // Locale ist de-DE → Komma als Decimal-Separator, kein Punkt-Trenner
    expect(input.value).toBe("1234,56");
  });

  test("blur mit gültigem Edit-String: onChange feuert Cents", () => {
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

  test("blur mit leerem String: onChange(undefined) räumt den Wert", () => {
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

  test("blur mit korruptem Input (Buchstaben): onChange wird NICHT gerufen", () => {
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

  test("+ Button: addiert 1 Major-Unit (=100 cents bei EUR) zum Canonical-Wert", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(onChange).toHaveBeenCalledWith(1100);
  });

  test("− Button: subtrahiert 1 Major-Unit", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "−" }));
    expect(onChange).toHaveBeenCalledWith(900);
  });

  test("+ Button bei leerem Wert: startet bei 0 + 1 Major-Unit", () => {
    const onChange = mock();
    render(
      <MoneyInput id="eur" name="eur" value="" onChange={onChange} currency="EUR" locale="de-DE" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  test("+ Button bei JPY: addiert 1 Yen (1 cent, weil JPY 0 decimals hat)", () => {
    const onChange = mock();
    render(
      <MoneyInput
        id="jpy"
        name="jpy"
        value={500}
        onChange={onChange}
        currency="JPY"
        locale="ja-JP"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    // factor=1 (10^0), bump(1) → +1 statt +100
    expect(onChange).toHaveBeenCalledWith(501);
  });
});

describe("parseLocaleNumber (strict-Negative)", () => {
  test("de-DE: erkennt Komma als Decimal", () => {
    expect(parseLocaleNumber("12,34", "de-DE")).toBe(12.34);
  });

  test("en-US: erkennt Punkt als Decimal", () => {
    expect(parseLocaleNumber("12.34", "en-US")).toBe(12.34);
  });

  test("Tausender-Trenner werden entfernt", () => {
    expect(parseLocaleNumber("1.234,56", "de-DE")).toBe(1234.56);
    expect(parseLocaleNumber("1,234.56", "en-US")).toBe(1234.56);
  });

  test("negativ am Anfang: wird als negative Zahl geparst", () => {
    expect(parseLocaleNumber("-12,34", "de-DE")).toBe(-12.34);
  });

  test("Minus mitten in der Zahl: NaN (strict — kein Silent-Fallback)", () => {
    // "1-23" könnte naiv als -123 interpretiert werden; das war der
    // Bug der vor dem Strict-Check existierte und vertippte Inputs zu
    // falschen Beträgen gemacht hat.
    expect(parseLocaleNumber("1-23", "de-DE")).toBeNaN();
  });

  test("Buchstaben oder Sonderzeichen: NaN", () => {
    expect(parseLocaleNumber("abc", "de-DE")).toBeNaN();
    expect(parseLocaleNumber("12,3a", "de-DE")).toBeNaN();
  });

  test("Leerstring oder reines Decimal: NaN", () => {
    expect(parseLocaleNumber("", "de-DE")).toBeNaN();
    expect(parseLocaleNumber(",", "de-DE")).toBeNaN();
  });
});

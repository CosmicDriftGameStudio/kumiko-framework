// DataTable-Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// Reine Funktionen aus primitives/index.tsx (exportiert für Test, wie
// money-input seine Pure-Logik exportiert). Kein DOM.

import { describe, expect, spyOn, test } from "bun:test";
import {
  applyFormatSpec,
  computeVisiblePages,
  defaultCellRender,
  isComponentRendererRef,
} from "../index";

describe("computeVisiblePages", () => {
  test("<= 7 Seiten: alle Seiten, keine Ellipsis", () => {
    expect(computeVisiblePages(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(computeVisiblePages(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("erste + letzte Seite immer als Anker enthalten", () => {
    const pages = computeVisiblePages(10, 20);
    expect(pages[0]).toBe(1);
    expect(pages.at(-1)).toBe(20);
  });

  test("Mitte (p=10/20): page±2-Window mit Ellipsen beidseitig", () => {
    expect(computeVisiblePages(10, 20)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12, "ellipsis", 20]);
  });

  test("Rand p=1/20: 5 Zahlen links sichtbar (Fenster verschoben, nicht abgeschnitten)", () => {
    expect(computeVisiblePages(1, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis", 20]);
  });

  test("Rand p=20/20: 5 Zahlen rechts sichtbar", () => {
    expect(computeVisiblePages(20, 20)).toEqual([1, "ellipsis", 16, 17, 18, 19, 20]);
  });

  test("page=5/20: Übergang Rand→Mitte (Ellipsis links erscheint)", () => {
    expect(computeVisiblePages(5, 20)).toEqual([1, "ellipsis", 3, 4, 5, 6, 7, "ellipsis", 20]);
  });

  test("page=16/20: letzte Mitte-Position (Ellipsis rechts noch da)", () => {
    expect(computeVisiblePages(16, 20)).toEqual([
      1,
      "ellipsis",
      14,
      15,
      16,
      17,
      18,
      "ellipsis",
      20,
    ]);
  });

  test("page=17/20: Übergang Mitte→Rand (Ellipsis rechts verschwindet, 5er-Tail)", () => {
    expect(computeVisiblePages(17, 20)).toEqual([1, "ellipsis", 16, 17, 18, 19, 20]);
  });
});

describe("isComponentRendererRef", () => {
  test("erkennt { react: { __component: 'Name' } }", () => {
    expect(isComponentRendererRef({ react: { __component: "MyCell" } })).toEqual({
      name: "MyCell",
    });
  });

  test("null / non-object / fehlender react-Branch → undefined", () => {
    expect(isComponentRendererRef(null)).toBeUndefined();
    expect(isComponentRendererRef("x")).toBeUndefined();
    expect(isComponentRendererRef({})).toBeUndefined();
    expect(isComponentRendererRef({ react: null })).toBeUndefined();
  });

  test("leerer oder fehlender __component → undefined", () => {
    expect(isComponentRendererRef({ react: {} })).toBeUndefined();
    expect(isComponentRendererRef({ react: { __component: "" } })).toBeUndefined();
  });
});

describe("applyFormatSpec", () => {
  test("null/undefined/leer → leerer String (priority rendert stattdessen emptyLabel)", () => {
    expect(applyFormatSpec({ format: "boolean" }, null)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "priority" }, "")).toBe("—");
  });

  test("boolean: true → ✓, false → leer (defaults)", () => {
    expect(applyFormatSpec({ format: "boolean" }, true)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false)).toBe("");
  });

  test("boolean: benutzerdefinierte Labels", () => {
    expect(
      applyFormatSpec({ format: "boolean", trueLabel: "Public", falseLabel: "Hidden" }, true),
    ).toBe("Public");
    expect(
      applyFormatSpec({ format: "boolean", trueLabel: "Public", falseLabel: "Hidden" }, false),
    ).toBe("Hidden");
  });

  test("currency: value + Leerzeichen + symbol", () => {
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, 42)).toBe("42 €");
    expect(applyFormatSpec({ format: "currency", symbol: "$" }, "99.90")).toBe("99.90 $");
  });

  test("currency: kein symbol → reiner Wert", () => {
    expect(applyFormatSpec({ format: "currency" }, 42)).toBe("42");
  });

  test("number/decimal: locale-formatiert via Intl.NumberFormat (fw#2160)", () => {
    for (const format of ["number", "decimal"] as const) {
      expect(applyFormatSpec({ format }, 245.5)).toBe(
        new Intl.NumberFormat(undefined).format(245.5),
      );
      expect(applyFormatSpec({ format, locale: "de-DE" }, 245.5)).toBe(
        new Intl.NumberFormat("de-DE").format(245.5),
      );
    }
  });

  test("bigInt: locale-formatiert (immer Integer auf der Wire — z.number().int().safe())", () => {
    // schema-builder.ts case "bigInt": mode:"number" round-trip, safe up to
    // 2^53 — bigInt fields are a plain JS number on the wire, never a bigint
    // primitive or string, so the same formatNumberCell path applies.
    expect(applyFormatSpec({ format: "bigInt" }, 1234567)).toBe(
      new Intl.NumberFormat(undefined).format(1234567),
    );
    expect(applyFormatSpec({ format: "bigInt", locale: "de-DE" }, 1234567)).toBe(
      new Intl.NumberFormat("de-DE").format(1234567),
    );
  });

  test("number: nicht-numerischer/NaN/Infinity Value fällt auf String zurück", () => {
    expect(applyFormatSpec({ format: "number" }, "not-a-number")).toBe("not-a-number");
    expect(applyFormatSpec({ format: "number" }, Number.NaN)).toBe("NaN");
    expect(applyFormatSpec({ format: "number" }, Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  test("number: ungültiges BCP-47 locale wirft nicht, fällt auf String zurück", () => {
    expect(() =>
      applyFormatSpec({ format: "number", locale: "not-a-locale!!" }, 245.5),
    ).not.toThrow();
    expect(applyFormatSpec({ format: "number", locale: "not-a-locale!!" }, 245.5)).toBe("245.5");
  });

  test("priority: 0 → Standard-Dash, Zahl → prefix+value", () => {
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 0)).toBe("—");
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 3)).toBe("P3");
  });

  test("priority: benutzerdefinierter emptyLabel + kein prefix", () => {
    expect(applyFormatSpec({ format: "priority", emptyLabel: "none" }, 0)).toBe("none");
    expect(applyFormatSpec({ format: "priority" }, 5)).toBe("5");
  });

  test("unbekanntes format → String(value) fallback + dev-warning", () => {
    // Warnung feuert nur bei NODE_ENV !== "production" — explizit setzen
    // statt sich aufs Test-Runner-Preset zu verlassen.
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(applyFormatSpec({ format: "custom-app-format" }, 42)).toBe("42");
      expect(applyFormatSpec({ format: "custom-app-format" }, "hello")).toBe("hello");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]?.[0]).toContain("custom-app-format");
    } finally {
      warn.mockRestore();
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });
});

describe("defaultCellRender", () => {
  test("null/undefined/leerer String → leerer String", () => {
    expect(defaultCellRender(null, "text")).toBe("");
    expect(defaultCellRender(undefined, "text")).toBe("");
    expect(defaultCellRender("", "text")).toBe("");
  });

  test("boolean → ✓ bei true, leer bei false", () => {
    expect(defaultCellRender(true, "boolean")).toBe("✓");
    expect(defaultCellRender(false, "boolean")).toBe("");
  });

  test("select → humanizeSlug (kebab → Title Case), wenn kein optionLabel", () => {
    expect(defaultCellRender("degraded-performance", "select")).toBe("Degraded performance");
  });

  test("select → registriertes optionLabel gewinnt vor humanizeSlug", () => {
    expect(defaultCellRender("op-x", "select", { "op-x": "Operativ X" })).toBe("Operativ X");
  });

  test("multiSelect → Werte gejoint mit ', ', optionLabel gewinnt vor humanizeSlug pro Wert (fw#2491)", () => {
    expect(
      defaultCellRender(["op-x", "degraded-performance"], "multiSelect", {
        "op-x": "Operativ X",
      }),
    ).toBe("Operativ X, Degraded performance");
  });

  test("multiSelect → leeres Array liefert leeren String", () => {
    expect(defaultCellRender([], "multiSelect")).toBe("");
  });

  test("multiSelect → einzelner Nicht-Array-Wert wird wie select behandelt (defensive)", () => {
    expect(defaultCellRender("op-x", "multiSelect", { "op-x": "Operativ X" })).toBe("Operativ X");
  });

  test("text → String-Repräsentation", () => {
    expect(defaultCellRender("hallo", "text")).toBe("hallo");
  });

  test("number/decimal → locale-formatiert, kein roher Dezimalpunkt (fw#2160)", () => {
    expect(defaultCellRender(42, "number")).toBe(new Intl.NumberFormat(undefined).format(42));
    expect(defaultCellRender(245.5, "decimal")).toBe(
      new Intl.NumberFormat(undefined).format(245.5),
    );
    // de-DE reference to make the fix concrete: "," instead of "." as the separator.
    expect(new Intl.NumberFormat("de-DE").format(245.5)).toBe("245,5");
  });

  test("number/decimal → explicit locale param wins over the runtime default (fw#2437)", () => {
    expect(defaultCellRender(245.5, "number", undefined, "de-DE")).toBe(
      new Intl.NumberFormat("de-DE").format(245.5),
    );
    expect(defaultCellRender(245.5, "decimal", undefined, "en-US")).toBe(
      new Intl.NumberFormat("en-US").format(245.5),
    );
    // Same value, two locales → two different strings, not just "locale is accepted".
    expect(defaultCellRender(245.5, "number", undefined, "de-DE")).not.toBe(
      defaultCellRender(245.5, "number", undefined, "en-US"),
    );
  });

  test("money → { amount, currency } formatiert, kein [object Object]", () => {
    const result = defaultCellRender({ amount: 450, currency: "EUR" }, "money");
    expect(result).not.toBe("[object Object]");
    expect(result.replace(/[^0-9]/g, "")).toBe("45000");
  });

  test("money → JPY ohne Nachkommastellen (currencyDecimals)", () => {
    const result = defaultCellRender({ amount: 1000, currency: "JPY" }, "money");
    const expected = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "JPY",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(1000);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/[.,]\d\d$/);
  });

  test("money → rehydrated { amount major, amountMinor } derives minor units from amount + currencyDecimals", () => {
    // rehydrateMoney (fw#1830): amount is major units, amountMinor is a flat
    // ×100 scale that disagrees with currencyDecimals for non-2-decimal
    // currencies — defaultCellRender ignores amountMinor and derives minor
    // units from `amount` instead (see index.tsx).
    const result = defaultCellRender({ amount: 119, currency: "EUR", amountMinor: 11900 }, "money");
    expect(result.replace(/[^0-9]/g, "")).toBe("11900");
  });

  test("money → zero-decimal currency (JPY) ignores amountMinor's mismatched flat scale", () => {
    const result = defaultCellRender({ amount: 500, currency: "JPY", amountMinor: 50000 }, "money");
    expect(result.replace(/[^0-9]/g, "")).toBe("500");
  });

  test("money → three-decimal currency (BHD) ignores amountMinor's mismatched flat scale", () => {
    const result = defaultCellRender({ amount: 1.5, currency: "BHD", amountMinor: 150 }, "money");
    expect(result.replace(/[^0-9]/g, "")).toBe("1500");
  });

  test("money → unerwarteter Value-Shape fällt auf String zurück", () => {
    expect(defaultCellRender(45000, "money")).toBe("45000");
  });

  test("money → invalid currency does not throw, falls back to [object Object] like pre-regression (#1494)", () => {
    expect(() => defaultCellRender({ amount: 1, currency: "" }, "money")).not.toThrow();
    expect(defaultCellRender({ amount: 1, currency: "" }, "money")).toBe("[object Object]");
  });

  test("money → explicit locale param wins over guessLocale's navigator fallback (fw#2437)", () => {
    const value = { amount: 1234.5, currency: "EUR" };
    const de = defaultCellRender(value, "money", undefined, "de-DE");
    const en = defaultCellRender(value, "money", undefined, "en-US");
    // Same amount, two locales → two different strings, not just "locale is accepted".
    expect(de).not.toBe(en);
    expect(de).toBe(
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(1234.5),
    );
    expect(en).toBe(
      new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(1234.5),
    );
  });
});

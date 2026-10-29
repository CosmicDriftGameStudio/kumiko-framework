// DataTable pure-logic tests.
//
// Pure functions from primitives/index.tsx, exported for testing as with
// money-input's pure logic. No DOM.

import { describe, expect, spyOn, test } from "bun:test";
import { applyFormatSpec, defaultCellRender, isComponentRendererRef } from "../index.tsx";

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

  test("empty or missing __component → undefined", () => {
    expect(isComponentRendererRef({ react: {} })).toBeUndefined();
    expect(isComponentRendererRef({ react: { __component: "" } })).toBeUndefined();
  });
});

describe("applyFormatSpec", () => {
  test("null/undefined/empty → empty string (priority renders emptyLabel instead)", () => {
    expect(applyFormatSpec({ format: "boolean" }, null)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "priority" }, "")).toBe("—");
  });

  test("boolean: true → ✓, false → empty (defaults)", () => {
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

  test("currency: no symbol → plain value", () => {
    expect(applyFormatSpec({ format: "currency" }, 42)).toBe("42");
  });

  test("number/decimal: locale-formatted via Intl.NumberFormat", () => {
    for (const format of ["number", "decimal"] as const) {
      expect(applyFormatSpec({ format }, 245.5)).toBe(
        new Intl.NumberFormat(undefined).format(245.5),
      );
      expect(applyFormatSpec({ format, locale: "de-DE" }, 245.5)).toBe(
        new Intl.NumberFormat("de-DE").format(245.5),
      );
    }
  });

  test("bigInt: locale-formatted (always an integer on the wire — z.number().int().safe())", () => {
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

  test("number: non-numeric/NaN/Infinity value falls back to string", () => {
    expect(applyFormatSpec({ format: "number" }, "not-a-number")).toBe("not-a-number");
    expect(applyFormatSpec({ format: "number" }, Number.NaN)).toBe("NaN");
    expect(applyFormatSpec({ format: "number" }, Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  test("number: invalid BCP-47 locale does not throw, falls back to string", () => {
    expect(() =>
      applyFormatSpec({ format: "number", locale: "not-a-locale!!" }, 245.5),
    ).not.toThrow();
    expect(applyFormatSpec({ format: "number", locale: "not-a-locale!!" }, 245.5)).toBe("245.5");
  });

  test("priority: 0 → Standard-Dash, Zahl → prefix+value", () => {
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 0)).toBe("—");
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 3)).toBe("P3");
  });

  test("priority: custom emptyLabel + no prefix", () => {
    expect(applyFormatSpec({ format: "priority", emptyLabel: "none" }, 0)).toBe("none");
    expect(applyFormatSpec({ format: "priority" }, 5)).toBe("5");
  });

  test("unbekanntes format → String(value) fallback + dev-warning", () => {
    // The warning fires only when NODE_ENV !== "production"; set it explicitly
    // instead of relying on the test runner preset.
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
  test("a money cell formats amount and currency from the row value", () => {
    const rent = { amount: 1200.5, currency: "EUR", amountScaled: 120050, amountMinor: 120050 };
    const shown = defaultCellRender(rent, "money", undefined, "de-DE");

    expect(shown).toContain("1.200,50");
    expect(shown).toContain("€");
  });

  test("null/undefined/empty string → empty string", () => {
    expect(defaultCellRender(null, "text")).toBe("");
    expect(defaultCellRender(undefined, "text")).toBe("");
    expect(defaultCellRender("", "text")).toBe("");
  });

  test("boolean → ✓ for true, empty for false", () => {
    expect(defaultCellRender(true, "boolean")).toBe("✓");
    expect(defaultCellRender(false, "boolean")).toBe("");
  });

  test("select → humanizeSlug (kebab → Title Case), when no optionLabel", () => {
    expect(defaultCellRender("degraded-performance", "select")).toBe("Degraded performance");
  });

  test("select → registered optionLabel takes precedence over humanizeSlug", () => {
    expect(defaultCellRender("op-x", "select", { "op-x": "Operativ X" })).toBe("Operativ X");
  });

  test("multiSelect → values joined with ', ', optionLabel takes precedence over humanizeSlug for each value", () => {
    expect(
      defaultCellRender(["op-x", "degraded-performance"], "multiSelect", {
        "op-x": "Operativ X",
      }),
    ).toBe("Operativ X, Degraded performance");
  });

  test("multiSelect → empty array returns an empty string", () => {
    expect(defaultCellRender([], "multiSelect")).toBe("");
  });

  test("multiSelect → single non-array value is handled like select (defensive)", () => {
    expect(defaultCellRender("op-x", "multiSelect", { "op-x": "Operativ X" })).toBe("Operativ X");
  });

  test("text → String representation", () => {
    expect(defaultCellRender("hallo", "text")).toBe("hallo");
  });

  test("date/timestamp → locale is passed through (de-DE vs en-US produce different strings)", () => {
    for (const [type, value] of [
      ["date", "2026-07-18"],
      ["timestamp", "2026-07-18T12:30:00.000Z"],
    ] as const) {
      const german = defaultCellRender(value, type, undefined, "de-DE");
      const american = defaultCellRender(value, type, undefined, "en-US");
      expect(german).not.toBe("");
      expect(american).not.toBe("");
      expect(german).not.toBe(american);
    }
  });

  test("ISO timestamp warning does not fire in production, but does in development for the same column", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const iso = "2026-09-04T12:30:00.000Z";
      process.env.NODE_ENV = "production";
      expect(defaultCellRender(iso, "text", undefined, undefined, "prodKillSwitchProbe")).toBe(iso);
      expect(warn).not.toHaveBeenCalled();
      // Production must not consume the per-column dedupe slot either.
      process.env.NODE_ENV = "development";
      defaultCellRender(iso, "text", undefined, undefined, "prodKillSwitchProbe");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });

  test("text column with a full ISO-8601 timestamp warns once per column, value remains unchanged", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const iso = "2026-09-04T12:30:00.000Z";
      expect(defaultCellRender(iso, "text", undefined, undefined, "dedupeProbeCreatedAt")).toBe(
        iso,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("dedupeProbeCreatedAt");
      // Same column, second row with a different ISO value → no second warning.
      expect(
        defaultCellRender(
          "2026-09-05T08:00:00Z",
          "text",
          undefined,
          undefined,
          "dedupeProbeCreatedAt",
        ),
      ).toBe("2026-09-05T08:00:00Z");
      expect(warn).toHaveBeenCalledTimes(1);
      // A different column still gets its own warning.
      expect(defaultCellRender(iso, "text", undefined, undefined, "dedupeProbeExpiresAt")).toBe(
        iso,
      );
      expect(warn).toHaveBeenCalledTimes(2);
      // Plain text and date-only strings never trigger the warning.
      expect(defaultCellRender("hallo", "text", undefined, undefined, "name")).toBe("hallo");
      expect(defaultCellRender("2026-09-04", "text", undefined, undefined, "day")).toBe(
        "2026-09-04",
      );
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });

  test("number/decimal → locale-formatted, no raw decimal point", () => {
    expect(defaultCellRender(42, "number")).toBe(new Intl.NumberFormat(undefined).format(42));
    expect(defaultCellRender(245.5, "decimal")).toBe(
      new Intl.NumberFormat(undefined).format(245.5),
    );
    // de-DE reference to make the fix concrete: "," instead of "." as the separator.
    expect(new Intl.NumberFormat("de-DE").format(245.5)).toBe("245,5");
  });

  test("number/decimal → explicit locale param wins over the runtime default", () => {
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

  test("money → { amount, currency } formatted, not [object Object]", () => {
    const result = defaultCellRender({ amount: 450, currency: "EUR" }, "money");
    expect(result).not.toBe("[object Object]");
    expect(result.replace(/[^0-9]/g, "")).toBe("45000");
  });

  test("money → JPY without fractional digits (currencyDecimals)", () => {
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
    // rehydrateMoney: amount is major units, amountMinor is a flat
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

  test("money → unexpected Value shape falls back to string", () => {
    expect(defaultCellRender(45000, "money")).toBe("45000");
  });

  test("money → invalid currency does not throw, falls back to [object Object]", () => {
    expect(() => defaultCellRender({ amount: 1, currency: "" }, "money")).not.toThrow();
    expect(defaultCellRender({ amount: 1, currency: "" }, "money")).toBe("[object Object]");
  });

  test("money → explicit locale param wins over guessLocale's navigator fallback", () => {
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

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createDecimalField, createEmbeddedListField } from "../factories.ts";
import {
  applyFormDerivations,
  type FormDerivationScreen,
  isFormDerivationInputMode,
  isUnusedFallbackOperand,
} from "../form-derivations.ts";
import { withFormDerivations } from "../with-form-derivations.ts";

const currency = { kind: "literal", code: "EUR" } as const;

const screen: FormDerivationScreen = {
  fields: {
    lines: createEmbeddedListField(
      {
        amount: { type: "money", required: true },
        vatRate: { type: "decimal", scale: 2, required: true },
        vatAmount: { type: "money" },
      },
      { derived: { vatAmount: { op: "percent", from: ["amount", "vatRate"] } } },
    ),
    netTotal: { type: "money", currency },
    vatRate: createDecimalField({ precision: 5, scale: 2 }),
    vatTotal: { type: "money", currency },
    grossTotal: { type: "money", currency },
  },
  derive: {
    netTotal: { op: "listSum", list: "lines", cell: "amount" },
    vatTotal: {
      op: "listSum",
      list: "lines",
      cell: "vatAmount",
      whenEmpty: { op: "percent", from: ["netTotal", "vatRate"] },
    },
    grossTotal: { op: "sum", from: ["netTotal", "vatTotal"] },
  },
};

const eur = (amount: number) => ({ amount, currency: "EUR" });

describe("applyFormDerivations", () => {
  test("lines present: sums the lines and overwrites manipulated client totals", () => {
    const result = applyFormDerivations(
      {
        lines: [
          { amount: 1005, vatRate: 19, vatAmount: 1 },
          { amount: 2000, vatRate: 7, vatAmount: 99999 },
        ],
        netTotal: eur(1),
        vatTotal: eur(2),
        grossTotal: eur(3),
        vatRate: 19,
      },
      screen,
    );
    // 19% of 10.05 = 1.9095 -> 1.91 EUR; 7% of 20.00 = 1.40 EUR
    expect(result).toMatchObject({
      netTotal: eur(30.05),
      vatTotal: eur(3.31),
      grossTotal: eur(33.36),
    });
  });

  test("no lines: net and rate are typed, VAT and gross follow", () => {
    const result = applyFormDerivations(
      { lines: [], netTotal: eur(100), vatRate: 19, vatTotal: eur(5), grossTotal: eur(1) },
      screen,
    );
    expect(result).toMatchObject({ netTotal: eur(100), vatTotal: eur(19), grossTotal: eur(119) });
  });

  test("a stale gross is overwritten and the target currency is kept", () => {
    const result = applyFormDerivations(
      {
        netTotal: { amount: 10, currency: "USD" },
        vatRate: 10,
        grossTotal: { amount: 500, currency: "USD" },
      },
      screen,
    );
    expect(result).toMatchObject({
      vatTotal: { amount: 1, currency: "USD" },
      grossTotal: { amount: 11, currency: "USD" },
    });
  });

  test("a result without sources removes the key; the input is not mutated", () => {
    const input = { lines: [], grossTotal: eur(9) };
    const result = applyFormDerivations(input, screen);
    expect(result).not.toHaveProperty("grossTotal");
    expect(input.grossTotal).toEqual(eur(9));
  });

  test("a non-object value passes through", () => {
    expect(applyFormDerivations("x", screen)).toBe("x");
  });

  test("a derivation cycle throws", () => {
    const cyclic: FormDerivationScreen = {
      fields: { a: { type: "money", currency }, b: { type: "money", currency } },
      derive: { a: { op: "sum", from: ["b"] }, b: { op: "sum", from: ["a"] } },
    };
    expect(() => applyFormDerivations({}, cyclic)).toThrow(/cycle/);
  });
});

describe("isFormDerivationInputMode", () => {
  test("a listSum without whenEmpty is an input while the list is empty", () => {
    expect(isFormDerivationInputMode(screen, { lines: [] }, "netTotal")).toBe(true);
    expect(isFormDerivationInputMode(screen, { lines: [{ amount: 1 }] }, "netTotal")).toBe(false);
  });

  test("fields with whenEmpty or a plain op are never inputs", () => {
    expect(isFormDerivationInputMode(screen, { lines: [] }, "vatTotal")).toBe(false);
    expect(isFormDerivationInputMode(screen, { lines: [] }, "grossTotal")).toBe(false);
  });
});

describe("isUnusedFallbackOperand", () => {
  test("a fallback-only operand is unused while the list has rows, used when it is empty", () => {
    expect(isUnusedFallbackOperand(screen, { lines: [{ amount: 1 }] }, "vatRate")).toBe(true);
    expect(isUnusedFallbackOperand(screen, { lines: [] }, "vatRate")).toBe(false);
    expect(isUnusedFallbackOperand(screen, {}, "vatRate")).toBe(false);
  });

  test("derived fields and operands of a plain op are never unused fallbacks", () => {
    const rows = { lines: [{ amount: 1 }] };
    expect(isUnusedFallbackOperand(screen, rows, "netTotal")).toBe(false);
    expect(isUnusedFallbackOperand(screen, rows, "grossTotal")).toBe(false);
    const plainReader: FormDerivationScreen = {
      ...screen,
      derive: { ...screen.derive, grossTotal: { op: "sum", from: ["netTotal", "vatRate"] } },
    };
    expect(isUnusedFallbackOperand(plainReader, rows, "vatRate")).toBe(false);
  });
});

describe("withFormDerivations", () => {
  test("the parsed output carries recomputed totals, not the client's", () => {
    const money = z.object({ amount: z.number(), currency: z.string() });
    const schema = withFormDerivations(
      z.object({ netTotal: money, vatRate: z.number(), vatTotal: money, grossTotal: money }),
      screen,
    );
    const parsed = schema.parse({
      netTotal: eur(200),
      vatRate: 19,
      vatTotal: eur(0),
      grossTotal: eur(0),
    });
    expect(parsed.vatTotal).toEqual(eur(38));
    expect(parsed.grossTotal).toEqual(eur(238));
  });
});

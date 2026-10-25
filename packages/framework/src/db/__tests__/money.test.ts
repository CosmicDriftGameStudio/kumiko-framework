// Pure unit tests for the money flatten/rehydrate helpers.
//
// Contract: API-form amounts use MAJOR units (56799.16 EUR), while DB-form
// amounts use MINOR units (5679916 cents). flattenMoney/rehydrateMoney convert
// at the boundary (×100 / ÷100). See money.ts's file header for why this exists.

import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { createEntity, createMoneyField, createTextField } from "../../engine/index.ts";

import {
  flattenMoney,
  type MoneyRead,
  moneyPayloadToMinorUnits,
  rehydrateMoney,
} from "../money.ts";

const orderEntity: EntityDefinition = createEntity({
  defaultCurrency: "EUR",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture" }),
    buyingPrice: createMoneyField(),
    sellingPrice: createMoneyField(),
  },
});

const usdEntity: EntityDefinition = createEntity({
  defaultCurrency: "USD",
  fields: {
    fee: createMoneyField(),
  },
});

describe("flattenMoney — Insert/Update Convert (major units → minor units)", () => {
  test("{ amount, currency } → { <name>: amount*100, <name>Currency: currency }", () => {
    const flat = flattenMoney({ buyingPrice: { amount: 450, currency: "EUR" } }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 45000, buyingPriceCurrency: "EUR" });
  });

  test("decimal amount rounds to the nearest cent", () => {
    const flat = flattenMoney({ buyingPrice: { amount: 56799.16, currency: "EUR" } }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 5679916, buyingPriceCurrency: "EUR" });
  });

  test("primitive number (legacy) is accepted and entity.defaultCurrency is appended", () => {
    const flat = flattenMoney({ buyingPrice: 450 }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 45000, buyingPriceCurrency: "EUR" });
  });

  test("primitive number uses USD when entity.defaultCurrency = USD", () => {
    const flat = flattenMoney({ fee: 1.99 }, usdEntity);
    expect(flat).toEqual({ fee: 199, feeCurrency: "USD" });
  });

  test("explicit <name>Currency in the payload is not overwritten", () => {
    const flat = flattenMoney({ buyingPrice: 450, buyingPriceCurrency: "USD" }, orderEntity);
    // If already set, do not overwrite it—the caller's explicit value wins.
    expect(flat["buyingPriceCurrency"]).toBe("USD");
  });

  test("mehrere money-Felder am gleichen Object", () => {
    const flat = flattenMoney(
      {
        buyingPrice: { amount: 450, currency: "EUR" },
        sellingPrice: { amount: 600, currency: "USD" },
      },
      orderEntity,
    );
    expect(flat).toEqual({
      buyingPrice: 45000,
      buyingPriceCurrency: "EUR",
      sellingPrice: 60000,
      sellingPriceCurrency: "USD",
    });
  });

  test("other fields remain unchanged", () => {
    const flat = flattenMoney(
      { label: "Premium", buyingPrice: { amount: 1, currency: "EUR" } },
      orderEntity,
    );
    expect(flat["label"]).toBe("Premium");
  });

  test("null/undefined money field is ignored (no crash)", () => {
    const flat = flattenMoney({ buyingPrice: undefined, sellingPrice: null }, orderEntity);
    expect(flat["buyingPrice"]).toBeUndefined();
    expect(flat["sellingPrice"]).toBeNull();
  });

  test("Framework default 'EUR' when entity.defaultCurrency is not set", () => {
    const noCurrencyEntity: EntityDefinition = createEntity({
      fields: { fee: createMoneyField() },
    });
    const flat = flattenMoney({ fee: 0.5 }, noCurrencyEntity);
    expect(flat["feeCurrency"]).toBe("EUR");
  });

  test("is pure — input is not mutated", () => {
    const input = { buyingPrice: { amount: 450, currency: "EUR" } };
    const before = JSON.stringify(input);
    flattenMoney(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("rehydrateMoney — Read Convert (minor units → major units)", () => {
  test("{ <name>: scaledUnits, <name>Currency: string } → { <name>: { amount: majorUnits, currency, amountScaled, amountMinor } }", () => {
    const out = rehydrateMoney({ buyingPrice: 45000, buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out).toEqual({
      buyingPrice: { amount: 450, currency: "EUR", amountScaled: 45000, amountMinor: 45000 },
    });
  });

  test("amountMinor is a deprecated alias of amountScaled, same value", () => {
    const out = rehydrateMoney({ buyingPrice: 45000, buyingPriceCurrency: "EUR" }, orderEntity)[
      "buyingPrice"
    ] as MoneyRead;
    expect(out.amountMinor).toBe(out.amountScaled);
  });

  test("PG-BIGINT as a string is cast to number", () => {
    // The Postgres driver sometimes returns BIGINT as a string (safe for values >2^53).
    const out = rehydrateMoney({ buyingPrice: "45000", buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out["buyingPrice"]).toEqual({
      amount: 450,
      currency: "EUR",
      amountScaled: 45000,
      amountMinor: 45000,
    });
  });

  test("missing Currency column falls back to entity.defaultCurrency", () => {
    const out = rehydrateMoney({ buyingPrice: 45000 }, orderEntity);
    expect(out["buyingPrice"]).toEqual({
      amount: 450,
      currency: "EUR",
      amountScaled: 45000,
      amountMinor: 45000,
    });
  });

  test("amountScaled remains an exact integer over multiple additions", () => {
    const rows = [10, 20, 30].map(
      (minor) =>
        rehydrateMoney({ buyingPrice: minor, buyingPriceCurrency: "EUR" }, orderEntity)[
          "buyingPrice"
        ] as MoneyRead,
    );
    const [a, b, c] = rows;

    expect(a!.amountScaled + b!.amountScaled).toBe(c!.amountScaled);
  });

  test("null/undefined amount → field is removed from output", () => {
    const out = rehydrateMoney({ buyingPrice: null, buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out["buyingPrice"]).toBeUndefined();
  });

  test("Mehrere money-Felder am gleichen Object", () => {
    const out = rehydrateMoney(
      {
        buyingPrice: 45000,
        buyingPriceCurrency: "EUR",
        sellingPrice: 60000,
        sellingPriceCurrency: "USD",
      },
      orderEntity,
    );
    expect(out).toEqual({
      buyingPrice: { amount: 450, currency: "EUR", amountScaled: 45000, amountMinor: 45000 },
      sellingPrice: { amount: 600, currency: "USD", amountScaled: 60000, amountMinor: 60000 },
    });
  });

  test("Round-Trip: flatten then rehydrate yields the same amount/currency, plus amountScaled", () => {
    const original = {
      buyingPrice: { amount: 450.5, currency: "EUR" },
      sellingPrice: { amount: 56799.16, currency: "USD" },
    };
    const flat = flattenMoney(original, orderEntity);
    const rehydrated = rehydrateMoney(flat, orderEntity);
    expect(rehydrated).toEqual({
      buyingPrice: { amount: 450.5, currency: "EUR", amountScaled: 45050, amountMinor: 45050 },
      sellingPrice: {
        amount: 56799.16,
        currency: "USD",
        amountScaled: 5679916,
        amountMinor: 5679916,
      },
    });
  });

  test("Round-Trip primitive-Insert: flatten(450) → rehydrate → { amount:450, currency:EUR, amountScaled:45000 }", () => {
    const flat = flattenMoney({ buyingPrice: 450 }, orderEntity);
    const out = rehydrateMoney(flat, orderEntity);
    expect(out["buyingPrice"]).toEqual({
      amount: 450,
      currency: "EUR",
      amountScaled: 45000,
      amountMinor: 45000,
    });
  });

  test("is pure — input is not mutated", () => {
    const input = { buyingPrice: 45000, buyingPriceCurrency: "EUR" };
    const before = JSON.stringify(input);
    rehydrateMoney(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("corrupt string amount (not a number) → loud throw, no silent drop", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: "not-a-number", buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/not a safe integer — DB corruption/);
  });

  test("fractional string amount → loud throw instead of amountScaled with a fractional part", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: "45000.7", buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/not a safe integer — DB corruption/);
  });

  test("string amount beyond Number.MAX_SAFE_INTEGER → loud throw instead of precision loss", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: "9007199254740993", buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/not a safe integer — DB corruption/);
  });

  test("unerwarteter amount-Typ (boolean) → loud throw", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: true, buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/unexpected type/);
  });
});

describe("Round-trip in the update path (helper chaining as in the executor)", () => {
  test("Update changes payload with money passes through flatten + back through rehydrate", () => {
    // Simulates the executor's flow: changes → flatten → DB → rehydrate
    const changes = { buyingPrice: { amount: 990, currency: "USD" } };
    const flat = flattenMoney(changes, orderEntity);
    expect(flat).toEqual({ buyingPrice: 99_000, buyingPriceCurrency: "USD" });

    // The DB returns the same columns
    const out = rehydrateMoney(flat, orderEntity);
    expect(out).toEqual({
      buyingPrice: { amount: 990, currency: "USD", amountScaled: 99_000, amountMinor: 99_000 },
    });
  });

  test("List-Pfad: mehrere Rows hintereinander rehydraten", () => {
    const dbRows = [
      { buyingPrice: 100, buyingPriceCurrency: "EUR" },
      { buyingPrice: 200, buyingPriceCurrency: "USD" },
      { buyingPrice: 300, buyingPriceCurrency: "GBP" },
    ];
    const apiRows = dbRows.map((r) => rehydrateMoney(r, orderEntity));
    expect(apiRows).toEqual([
      { buyingPrice: { amount: 1, currency: "EUR", amountScaled: 100, amountMinor: 100 } },
      { buyingPrice: { amount: 2, currency: "USD", amountScaled: 200, amountMinor: 200 } },
      { buyingPrice: { amount: 3, currency: "GBP", amountScaled: 300, amountMinor: 300 } },
    ]);
  });
});

describe("flattenMoney — Strict-Mode Throw", () => {
  test("string as a value (instead of number/object) → loud throw", () => {
    expect(() => flattenMoney({ buyingPrice: "100" }, orderEntity)).toThrow(
      /expects \{ amount, currency \} object or number/,
    );
  });
});

// The write-handler-facing counterpart a custom
// totals check needs when reconciling a top-level money field's payload
// (major units, `{amount, currency}` or bare number) against an
// embedded-list row sum (minor-unit integers by convention).
describe("moneyPayloadToMinorUnits", () => {
  test("{ amount, currency } object, crooked amount, rounds to the exact cent", () => {
    expect(moneyPayloadToMinorUnits({ amount: 1234.56, currency: "EUR" })).toBe(123456);
  });

  test("legacy bare-number payload (also major units, per flattenMoney's permissive-insert contract)", () => {
    expect(moneyPayloadToMinorUnits(1234.56)).toBe(123456);
  });

  test("a round amount does not mask a factor-of-100 regression: 30 major -> 3000 minor, not 30", () => {
    expect(moneyPayloadToMinorUnits({ amount: 30, currency: "EUR" })).toBe(3000);
  });

  test("undefined for a payload without a numeric amount (nothing to compare)", () => {
    expect(moneyPayloadToMinorUnits({ currency: "EUR" })).toBeUndefined();
    expect(moneyPayloadToMinorUnits("100")).toBeUndefined();
    expect(moneyPayloadToMinorUnits(null)).toBeUndefined();
    expect(moneyPayloadToMinorUnits(undefined)).toBeUndefined();
  });
});

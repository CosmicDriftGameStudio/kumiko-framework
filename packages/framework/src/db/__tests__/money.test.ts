// Pure unit tests for the money flatten/rehydrate helpers.
//
// Contract: API, event and DB carry the same integer amount in the currency's
// minor unit (4500 = 45.00 EUR). flattenMoney/rehydrateMoney split and join the
// amount/currency columns without converting. See money.ts's file header.

import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { createEntity, createMoneyField, createTextField } from "../../engine/index.ts";

import { flattenMoney, rehydrateMoney } from "../money.ts";

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

const jpyEntity: EntityDefinition = createEntity({
  defaultCurrency: "JPY",
  fields: {
    fee: createMoneyField(),
  },
});

describe("flattenMoney — splits { amount, currency } into the two columns", () => {
  test("{ amount, currency } → { <name>: amount, <name>Currency: currency }", () => {
    const flat = flattenMoney({ buyingPrice: { amount: 45000, currency: "EUR" } }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 45000, buyingPriceCurrency: "EUR" });
  });

  test("currency falls back to entity.defaultCurrency", () => {
    const flat = flattenMoney({ fee: { amount: 199 } }, usdEntity);
    expect(flat).toEqual({ fee: 199, feeCurrency: "USD" });
  });

  test("JPY amount is stored as given (0 decimals)", () => {
    const flat = flattenMoney({ fee: { amount: 1200, currency: "JPY" } }, jpyEntity);
    expect(flat).toEqual({ fee: 1200, feeCurrency: "JPY" });
  });

  test("a non-integer amount throws", () => {
    expect(() =>
      flattenMoney({ buyingPrice: { amount: 12.5, currency: "EUR" } }, orderEntity),
    ).toThrow(/amount must be an integer in minor units of EUR \(got 12\.5\)/);
  });

  test("a bare number throws", () => {
    expect(() => flattenMoney({ buyingPrice: 450 }, orderEntity)).toThrow(
      /expected \{ amount, currency \} with amount in minor units/,
    );
  });

  test("mehrere money-Felder am gleichen Object", () => {
    const flat = flattenMoney(
      {
        buyingPrice: { amount: 45000, currency: "EUR" },
        sellingPrice: { amount: 60000, currency: "USD" },
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
      { label: "Premium", buyingPrice: { amount: 100, currency: "EUR" } },
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
    const flat = flattenMoney({ fee: { amount: 50 } }, noCurrencyEntity);
    expect(flat["feeCurrency"]).toBe("EUR");
  });

  test("is pure — input is not mutated", () => {
    const input = { buyingPrice: { amount: 45000, currency: "EUR" } };
    const before = JSON.stringify(input);
    flattenMoney(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("rehydrateMoney — joins the two columns into { amount, currency }", () => {
  test("{ <name>: minorUnits, <name>Currency: string } → { <name>: { amount, currency } }", () => {
    const out = rehydrateMoney({ buyingPrice: 45000, buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out).toEqual({
      buyingPrice: { amount: 45000, currency: "EUR" },
    });
  });

  test("PG-BIGINT as a string is cast to number", () => {
    // The Postgres driver sometimes returns BIGINT as a string (safe for values >2^53).
    const out = rehydrateMoney({ buyingPrice: "45000", buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out["buyingPrice"]).toEqual({ amount: 45000, currency: "EUR" });
  });

  test("missing Currency column falls back to entity.defaultCurrency", () => {
    const out = rehydrateMoney({ buyingPrice: 45000 }, orderEntity);
    expect(out["buyingPrice"]).toEqual({ amount: 45000, currency: "EUR" });
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
      buyingPrice: { amount: 45000, currency: "EUR" },
      sellingPrice: { amount: 60000, currency: "USD" },
    });
  });

  test("Round-Trip: flatten then rehydrate yields the same { amount, currency }", () => {
    const original = {
      buyingPrice: { amount: 45050, currency: "EUR" },
      sellingPrice: { amount: 5679916, currency: "USD" },
    };
    const flat = flattenMoney(original, orderEntity);
    expect(rehydrateMoney(flat, orderEntity)).toEqual(original);
  });

  test("the read shape has no amountScaled key", () => {
    const out = rehydrateMoney({ buyingPrice: 45000, buyingPriceCurrency: "EUR" }, orderEntity);
    expect(Object.keys(out["buyingPrice"] as object).sort()).toEqual(["amount", "currency"]);
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

  test("fractional string amount → loud throw instead of an amount with a fractional part", () => {
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
    const changes = { buyingPrice: { amount: 99_000, currency: "USD" } };
    const flat = flattenMoney(changes, orderEntity);
    expect(flat).toEqual({ buyingPrice: 99_000, buyingPriceCurrency: "USD" });

    // The DB returns the same columns
    const out = rehydrateMoney(flat, orderEntity);
    expect(out).toEqual({
      buyingPrice: { amount: 99_000, currency: "USD" },
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
      { buyingPrice: { amount: 100, currency: "EUR" } },
      { buyingPrice: { amount: 200, currency: "USD" } },
      { buyingPrice: { amount: 300, currency: "GBP" } },
    ]);
  });
});

describe("flattenMoney — Strict-Mode Throw", () => {
  test("string as a value (instead of an object) → loud throw", () => {
    expect(() => flattenMoney({ buyingPrice: "100" }, orderEntity)).toThrow(
      /expected \{ amount, currency \} with amount in minor units/,
    );
  });
});

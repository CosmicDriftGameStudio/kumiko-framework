// Pure Unit-Tests für money flatten/rehydrate Helpers.

import { describe, expect, test } from "vitest";
import { createEntity, createMoneyField, createTextField } from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { flattenMoney, rehydrateMoney } from "../money";

const orderEntity: EntityDefinition = createEntity({
  defaultCurrency: "EUR",
  fields: {
    label: createTextField(),
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

describe("flattenMoney — Insert/Update Convert", () => {
  test("{ amount, currency } → { <name>: amount, <name>Currency: currency }", () => {
    const flat = flattenMoney({ buyingPrice: { amount: 45000, currency: "EUR" } }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 45000, buyingPriceCurrency: "EUR" });
  });

  test("primitive number (legacy) wird akzeptiert + entity.defaultCurrency angehängt", () => {
    const flat = flattenMoney({ buyingPrice: 45000 }, orderEntity);
    expect(flat).toEqual({ buyingPrice: 45000, buyingPriceCurrency: "EUR" });
  });

  test("primitive number nutzt USD wenn entity.defaultCurrency = USD", () => {
    const flat = flattenMoney({ fee: 199 }, usdEntity);
    expect(flat).toEqual({ fee: 199, feeCurrency: "USD" });
  });

  test("expliziter <name>Currency im Payload überschreibt nicht", () => {
    const flat = flattenMoney({ buyingPrice: 45000, buyingPriceCurrency: "USD" }, orderEntity);
    // Wenn bereits gesetzt, nicht überschreiben — caller-explicit gewinnt
    expect(flat["buyingPriceCurrency"]).toBe("USD");
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

  test("andere Felder bleiben unverändert", () => {
    const flat = flattenMoney(
      { label: "Premium", buyingPrice: { amount: 100, currency: "EUR" } },
      orderEntity,
    );
    expect(flat["label"]).toBe("Premium");
  });

  test("null/undefined money-Field wird ignoriert (kein crash)", () => {
    const flat = flattenMoney({ buyingPrice: undefined, sellingPrice: null }, orderEntity);
    expect(flat["buyingPrice"]).toBeUndefined();
    expect(flat["sellingPrice"]).toBeNull();
  });

  test("Framework-Default 'EUR' wenn entity.defaultCurrency nicht gesetzt", () => {
    const noCurrencyEntity: EntityDefinition = createEntity({
      fields: { fee: createMoneyField() },
    });
    const flat = flattenMoney({ fee: 50 }, noCurrencyEntity);
    expect(flat["feeCurrency"]).toBe("EUR");
  });

  test("ist pure — input wird nicht mutiert", () => {
    const input = { buyingPrice: { amount: 45000, currency: "EUR" } };
    const before = JSON.stringify(input);
    flattenMoney(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("rehydrateMoney — Read Convert", () => {
  test("{ <name>: number, <name>Currency: string } → { <name>: { amount, currency } }", () => {
    const out = rehydrateMoney({ buyingPrice: 45000, buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out).toEqual({ buyingPrice: { amount: 45000, currency: "EUR" } });
  });

  test("PG-BIGINT als String wird zu number gecastet", () => {
    // Postgres-driver liefert BIGINT manchmal als String (>2^53 sicher).
    const out = rehydrateMoney({ buyingPrice: "45000", buyingPriceCurrency: "EUR" }, orderEntity);
    expect(out["buyingPrice"]).toEqual({ amount: 45000, currency: "EUR" });
  });

  test("fehlende Currency-Spalte fällt auf entity.defaultCurrency", () => {
    const out = rehydrateMoney({ buyingPrice: 45000 }, orderEntity);
    expect(out["buyingPrice"]).toEqual({ amount: 45000, currency: "EUR" });
  });

  test("null/undefined amount → Field wird aus Output entfernt", () => {
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

  test("Round-Trip: flatten dann rehydrate ergibt dasselbe", () => {
    const original = {
      buyingPrice: { amount: 45000, currency: "EUR" },
      sellingPrice: { amount: 60000, currency: "USD" },
    };
    const flat = flattenMoney(original, orderEntity);
    const rehydrated = rehydrateMoney(flat, orderEntity);
    expect(rehydrated).toEqual(original);
  });

  test("Round-Trip primitive-Insert: flatten(45000) → rehydrate → { amount:45000, currency:EUR }", () => {
    const flat = flattenMoney({ buyingPrice: 45000 }, orderEntity);
    const out = rehydrateMoney(flat, orderEntity);
    expect(out["buyingPrice"]).toEqual({ amount: 45000, currency: "EUR" });
  });

  test("ist pure — input wird nicht mutiert", () => {
    const input = { buyingPrice: 45000, buyingPriceCurrency: "EUR" };
    const before = JSON.stringify(input);
    rehydrateMoney(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("korrupte string-amount (kein number) → loud throw, kein silent drop", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: "not-a-number", buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/not a number — DB corruption/);
  });

  test("unerwarteter amount-Typ (boolean) → loud throw", () => {
    expect(() =>
      rehydrateMoney({ buyingPrice: true, buyingPriceCurrency: "EUR" }, orderEntity),
    ).toThrow(/unexpected type/);
  });
});

describe("Round-Trip im Update-Pfad (Helper-Verkettung wie im Executor)", () => {
  test("Update-Changes-Payload mit money geht durch flatten + zurück durch rehydrate", () => {
    // Simuliert was der Executor macht: changes → flatten → DB → rehydrate
    const changes = { buyingPrice: { amount: 99_000, currency: "USD" } };
    const flat = flattenMoney(changes, orderEntity);
    expect(flat).toEqual({ buyingPrice: 99_000, buyingPriceCurrency: "USD" });

    // DB liefert dieselben Spalten zurück
    const out = rehydrateMoney(flat, orderEntity);
    expect(out).toEqual({ buyingPrice: { amount: 99_000, currency: "USD" } });
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
  test("string als Wert (statt number/object) → loud throw", () => {
    expect(() => flattenMoney({ buyingPrice: "100" }, orderEntity)).toThrow(
      /expects \{ amount, currency \} object or number/,
    );
  });
});

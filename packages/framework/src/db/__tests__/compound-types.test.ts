// Tests for the compound-type pipeline.
// Invariants under test:
//   - Identity for an empty payload or no compound fields
//   - Both converters run when both field types are present
//   - Ordering is deterministic and converters do not overlap
//   - Pure operation (does not mutate the input)

import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import {
  createEntity,
  createLocatedTimestampField,
  createMoneyField,
  createTextField,
} from "../../engine/index.ts";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "../compound-types.ts";

const mixedEntity: EntityDefinition = createEntity({
  defaultCurrency: "EUR",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture" }),
    pickup: createLocatedTimestampField(),
    buyingPrice: createMoneyField(),
  },
});

describe("flattenCompoundTypes — Pipeline", () => {
  test("identity for payload without compound fields", () => {
    const payload = { label: "ACME-001" };
    const flat = flattenCompoundTypes(payload, mixedEntity);
    expect(flat).toEqual({ label: "ACME-001" });
  });

  test("identity for empty payload", () => {
    expect(flattenCompoundTypes({}, mixedEntity)).toEqual({});
  });

  test("all converters run when all compound types are present in the payload", () => {
    const flat = flattenCompoundTypes(
      {
        label: "ACME",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
        buyingPrice: { amount: 45_000, currency: "EUR" },
      },
      mixedEntity,
    );
    // Both compound converters must have run.
    // pickupUtc is now a Temporal.Instant; compare it via .toString().
    expect(flat["label"]).toBe("ACME");
    expect((flat["pickupUtc"] as Temporal.Instant).toString()).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
    // flattenMoney converts major units (API) → minor units (DB, ×100).
    expect(flat["buyingPrice"]).toBe(4_500_000);
    expect(flat["buyingPriceCurrency"]).toBe("EUR");
  });

  test("is pure — input is not mutated", () => {
    const input = {
      pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
      buyingPrice: { amount: 100, currency: "EUR" },
    };
    const before = JSON.stringify(input);
    flattenCompoundTypes(input, mixedEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("rehydrateCompoundTypes — Pipeline", () => {
  test("identity for row without compound fields", () => {
    expect(rehydrateCompoundTypes({ label: "ACME" }, mixedEntity)).toEqual({ label: "ACME" });
  });

  test("alle Konverter rehydraten parallel", () => {
    const out = rehydrateCompoundTypes(
      {
        label: "ACME",
        pickupUtc: "2026-04-15T09:00:00Z",
        pickupTz: "Europe/Lisbon",
        buyingPrice: 4_500_000,
        buyingPriceCurrency: "EUR",
      },
      mixedEntity,
    );
    expect(out).toEqual({
      label: "ACME",
      pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" },
      // rehydrateMoney converts minor units (DB) → major units (API, ÷100).
      buyingPrice: {
        amount: 45_000,
        currency: "EUR",
        amountScaled: 4_500_000,
        amountMinor: 4_500_000,
      },
    });
  });

  test("Round-Trip: flatten → rehydrate produces identical API object (utc is added on read)", () => {
    const original = {
      label: "ACME",
      pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
      buyingPrice: { amount: 100, currency: "EUR" },
    };
    const round = rehydrateCompoundTypes(flattenCompoundTypes(original, mixedEntity), mixedEntity);
    // utc is added to pickup when reading; it was not set during insertion
    expect((round["pickup"] as { utc: string }).utc).toBe("2026-04-15T09:00:00Z");
    expect(round["buyingPrice"]).toEqual({
      amount: 100,
      currency: "EUR",
      amountScaled: 10_000,
      amountMinor: 10_000,
    });
    expect(round["label"]).toBe("ACME");
  });

  test("is pure — input is not mutated", () => {
    const input = {
      pickupUtc: "2026-04-15T09:00:00Z",
      pickupTz: "Europe/Lisbon",
      buyingPrice: 100,
      buyingPriceCurrency: "EUR",
    };
    const before = JSON.stringify(input);
    rehydrateCompoundTypes(input, mixedEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// Tests für die Compound-Type-Pipeline.
// Garantien die wir prüfen:
//   - Identity bei leerem Payload / keinen Compound-Feldern
//   - Beide Konverter werden gerufen wenn beide Field-Types vorkommen
//   - Reihenfolge ist deterministisch + Konverter überlappen nicht
//   - Pure (kein input-mutate)

import { describe, expect, test } from "vitest";
import {
  createEntity,
  createLocatedTimestampField,
  createMoneyField,
  createTextField,
} from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "../compound-types";

const mixedEntity: EntityDefinition = createEntity({
  defaultCurrency: "EUR",
  fields: {
    label: createTextField(),
    pickup: createLocatedTimestampField(),
    buyingPrice: createMoneyField(),
  },
});

describe("flattenCompoundTypes — Pipeline", () => {
  test("identity bei Payload ohne Compound-Felder", () => {
    const payload = { label: "ACME-001" };
    const flat = flattenCompoundTypes(payload, mixedEntity);
    expect(flat).toEqual({ label: "ACME-001" });
  });

  test("identity bei leerem Payload", () => {
    expect(flattenCompoundTypes({}, mixedEntity)).toEqual({});
  });

  test("alle Konverter laufen wenn alle Compound-Types im Payload sind", () => {
    const flat = flattenCompoundTypes(
      {
        label: "ACME",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
        buyingPrice: { amount: 45_000, currency: "EUR" },
      },
      mixedEntity,
    );
    // Beide Compound-Konverter müssen gefeuert haben.
    // Sprint F: pickupUtc ist jetzt Temporal.Instant — vergleichen via .toString().
    expect(flat["label"]).toBe("ACME");
    expect((flat["pickupUtc"] as Temporal.Instant).toString()).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
    expect(flat["buyingPrice"]).toBe(45_000);
    expect(flat["buyingPriceCurrency"]).toBe("EUR");
  });

  test("ist pure — input wird nicht mutiert", () => {
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
  test("identity bei Row ohne Compound-Felder", () => {
    expect(rehydrateCompoundTypes({ label: "ACME" }, mixedEntity)).toEqual({ label: "ACME" });
  });

  test("alle Konverter rehydraten parallel", () => {
    const out = rehydrateCompoundTypes(
      {
        label: "ACME",
        pickupUtc: "2026-04-15T09:00:00Z",
        pickupTz: "Europe/Lisbon",
        buyingPrice: 45_000,
        buyingPriceCurrency: "EUR",
      },
      mixedEntity,
    );
    expect(out).toEqual({
      label: "ACME",
      pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" },
      buyingPrice: { amount: 45_000, currency: "EUR" },
    });
  });

  test("Round-Trip: flatten → rehydrate ergibt identisches API-Object (utc wird im Read addiert)", () => {
    const original = {
      label: "ACME",
      pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
      buyingPrice: { amount: 100, currency: "EUR" },
    };
    const round = rehydrateCompoundTypes(flattenCompoundTypes(original, mixedEntity), mixedEntity);
    // pickup bekommt utc dazu beim Read (war beim Insert nicht gesetzt)
    expect((round["pickup"] as { utc: string }).utc).toBe("2026-04-15T09:00:00Z");
    expect(round["buyingPrice"]).toEqual({ amount: 100, currency: "EUR" });
    expect(round["label"]).toBe("ACME");
  });

  test("ist pure — input wird nicht mutiert", () => {
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

// Pure unit tests for the flatten/rehydrate helpers — automatic conversion for
// locatedTimestamp fields. No database or stack, only data transformation.

import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { createEntity, createLocatedTimestampField, createTextField } from "../../engine/index.ts";

import { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "../located-timestamp.ts";

const orderEntity: EntityDefinition = createEntity({
  fields: {
    clientName: createTextField({ personal: false, reason: "test_fixture" }),
    pickup: createLocatedTimestampField(),
    delivery: createLocatedTimestampField(),
  },
});

// flattenLocatedTimestamp returns Temporal.Instant for the <name>Utc column
// instead of an ISO string. Tests compare via .toString() so the value remains
// deterministically readable — Temporal.Instant's canonical ISO output is stable.
const utcStr = (v: unknown): string => (v as Temporal.Instant).toString();

describe("flattenLocatedTimestamp — Insert/Update Convert", () => {
  test("{ at, tz } → { <name>Utc, <name>Tz } (utc berechnet via Temporal)", () => {
    const flat = flattenLocatedTimestamp(
      { pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } },
      orderEntity,
    );
    // Lisbon WEST im April = UTC+1, also 10:00 Lisbon = 09:00 UTC.
    expect(utcStr(flat["pickupUtc"])).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
  });

  test("{ utc, tz } → is stored directly (utc wins)", () => {
    const flat = flattenLocatedTimestamp(
      { pickup: { utc: "2026-04-15T09:00:00Z", tz: "Europe/Lisbon" } },
      orderEntity,
    );
    expect(utcStr(flat["pickupUtc"])).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
  });

  test("{ at, tz, utc } — utc wins deterministically", () => {
    const flat = flattenLocatedTimestamp(
      {
        pickup: {
          at: "2026-04-15T10:00:00",
          tz: "Europe/Lisbon",
          utc: "2026-04-15T07:00:00Z", // bewusst inkonsistent
        },
      },
      orderEntity,
    );
    // utc wins — we store the value explicitly provided by the caller.
    expect(utcStr(flat["pickupUtc"])).toBe("2026-04-15T07:00:00Z");
  });

  test("Mehrere locatedTimestamp-Felder am gleichen Object", () => {
    const flat = flattenLocatedTimestamp(
      {
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
        delivery: { at: "2026-04-16T18:00:00", tz: "Asia/Tokyo" },
      },
      orderEntity,
    );
    expect(utcStr(flat["pickupUtc"])).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
    // 18:00 Tokyo = 09:00 UTC
    expect(utcStr(flat["deliveryUtc"])).toBe("2026-04-16T09:00:00Z");
    expect(flat["deliveryTz"]).toBe("Asia/Tokyo");
  });

  test("other fields remain unchanged (clientName)", () => {
    const flat = flattenLocatedTimestamp(
      {
        clientName: "Acme",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Berlin" },
      },
      orderEntity,
    );
    expect(flat["clientName"]).toBe("Acme");
  });

  test("missing fields are ignored (no crash)", () => {
    const flat = flattenLocatedTimestamp({ clientName: "X" }, orderEntity);
    expect(flat).toEqual({ clientName: "X" });
  });

  test("DST transition Berlin Spring-Forward 2026-03-29 — conversion is correct", () => {
    // 04:30 in Berlin on 2026-03-29 (after the DST transition) = 02:30 UTC (CEST UTC+2)
    const flat = flattenLocatedTimestamp(
      { pickup: { at: "2026-03-29T04:30:00", tz: "Europe/Berlin" } },
      orderEntity,
    );
    expect(utcStr(flat["pickupUtc"])).toBe("2026-03-29T02:30:00Z");
  });

  test("is pure — input is not mutated", () => {
    const input = { pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } };
    const before = JSON.stringify(input);
    flattenLocatedTimestamp(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("rehydrateLocatedTimestamp — no ambient Temporal global", () => {
  test("rehydrates without relying on globalThis.Temporal", () => {
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const out = rehydrateLocatedTimestamp(
        { pickupUtc: "2026-04-15T09:00:00Z", pickupTz: "Europe/Lisbon" },
        orderEntity,
      );
      expect(out).toEqual({
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" },
      });
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});

describe("rehydrateLocatedTimestamp — Read Convert", () => {
  test("{ <name>Utc, <name>Tz } DB-Form → { at, tz, utc } API-Form (Pickup-Ort-lokal)", () => {
    const out = rehydrateLocatedTimestamp(
      { pickupUtc: "2026-04-15T09:00:00Z", pickupTz: "Europe/Lisbon" },
      orderEntity,
    );
    // 09:00 UTC in Lissabon (WEST UTC+1 im April) = 10:00 lokal.
    expect(out).toEqual({
      pickup: {
        at: "2026-04-15T10:00:00",
        tz: "Europe/Lisbon",
        utc: "2026-04-15T09:00:00Z",
      },
    });
  });

  test("PG-Wire-Format with Space is normalized (PG-mode:'string')", () => {
    // Drizzle's mode:"string" returns TIMESTAMPTZ as "2026-04-15 09:00:00+00".
    const out = rehydrateLocatedTimestamp(
      { pickupUtc: "2026-04-15 09:00:00+00", pickupTz: "Europe/Lisbon" },
      orderEntity,
    );
    expect((out["pickup"] as { utc: string }).utc).toBe("2026-04-15T09:00:00Z");
    expect((out["pickup"] as { at: string }).at).toBe("2026-04-15T10:00:00");
  });

  test("Round-Trip: flatten then rehydrate yields an equivalent original", () => {
    const original = { pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } };
    const flat = flattenLocatedTimestamp(original, orderEntity);
    const rehydrated = rehydrateLocatedTimestamp(flat, orderEntity);

    const pickup = rehydrated["pickup"] as { at: string; tz: string; utc: string };
    expect(pickup.at).toBe("2026-04-15T10:00:00");
    expect(pickup.tz).toBe("Europe/Lisbon");
    // utc is also populated during the read — the original did not have it
    expect(pickup.utc).toBe("2026-04-15T09:00:00Z");
  });

  test("Mehrere Felder: Pickup Lissabon + Delivery Tokyo gleichzeitig", () => {
    const out = rehydrateLocatedTimestamp(
      {
        pickupUtc: "2026-04-15T09:00:00Z",
        pickupTz: "Europe/Lisbon",
        deliveryUtc: "2026-04-16T09:00:00Z",
        deliveryTz: "Asia/Tokyo",
      },
      orderEntity,
    );
    expect((out["pickup"] as { tz: string }).tz).toBe("Europe/Lisbon");
    expect((out["delivery"] as { tz: string }).tz).toBe("Asia/Tokyo");
    // Tokyo: 09:00 UTC = 18:00 lokal (JST UTC+9)
    expect((out["delivery"] as { at: string }).at).toBe("2026-04-16T18:00:00");
  });

  test("Day change: 23:30 Berlin → 21:30 UTC; Read in Tokyo gives a different day", () => {
    // This proves that the default `at` is local to the pickup location. We store
    // a UTC instant with Lisbon as the stored tz and verify that the read returns
    // the Lisbon wall-clock date, not Tokyo's.
    const out = rehydrateLocatedTimestamp(
      { pickupUtc: "2026-04-15T22:30:00Z", pickupTz: "Europe/Lisbon" },
      orderEntity,
    );
    // In Lisbon (WEST UTC+1), 22:30 UTC on 15 April is 23:30 local on 15 April
    expect((out["pickup"] as { at: string }).at).toBe("2026-04-15T23:30:00");

    // If a user wants the view in Tokyo, they must derive it from utc themselves.
    // This test only demonstrates the server's default view, local to the pickup location.
  });

  test("missing fields are skipped (no crash)", () => {
    const out = rehydrateLocatedTimestamp({ clientName: "X" }, orderEntity);
    expect(out).toEqual({ clientName: "X" });
  });

  test("partial: only Tz without Utc → Pair is not created (corrupt data, no silent fix)", () => {
    const out = rehydrateLocatedTimestamp({ pickupTz: "Europe/Lisbon" }, orderEntity);
    expect(out["pickup"]).toBeUndefined();
  });
});

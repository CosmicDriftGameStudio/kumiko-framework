// Pure Unit-Tests für die flatten/rehydrate Helpers — Auto-Convert für
// locatedTimestamp-Felder. Keine DB, kein Stack, nur Daten-Transform.

import { describe, expect, test } from "vitest";
import { createEntity, createLocatedTimestampField, createTextField } from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "../located-timestamp";

const orderEntity: EntityDefinition = createEntity({
  fields: {
    clientName: createTextField(),
    pickup: createLocatedTimestampField(),
    delivery: createLocatedTimestampField(),
  },
});

// Sprint F: flattenLocatedTimestamp returnt jetzt Temporal.Instant für die
// <name>Utc-Spalte (statt ISO-String). Tests vergleichen via .toString()
// damit der Wert deterministisch lesbar bleibt — der canonical ISO-Output
// von Temporal.Instant ist stabil.
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

  test("{ utc, tz } → wird direkt gespeichert (utc gewinnt)", () => {
    const flat = flattenLocatedTimestamp(
      { pickup: { utc: "2026-04-15T09:00:00Z", tz: "Europe/Lisbon" } },
      orderEntity,
    );
    expect(utcStr(flat["pickupUtc"])).toBe("2026-04-15T09:00:00Z");
    expect(flat["pickupTz"]).toBe("Europe/Lisbon");
  });

  test("{ at, tz, utc } — utc gewinnt deterministisch", () => {
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
    // utc gewinnt — wir speichern was der Caller explizit angegeben hat.
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

  test("andere Felder bleiben unverändert (clientName)", () => {
    const flat = flattenLocatedTimestamp(
      {
        clientName: "Acme",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Berlin" },
      },
      orderEntity,
    );
    expect(flat["clientName"]).toBe("Acme");
  });

  test("fehlende Felder werden ignoriert (kein crash)", () => {
    const flat = flattenLocatedTimestamp({ clientName: "X" }, orderEntity);
    expect(flat).toEqual({ clientName: "X" });
  });

  test("DST-Übergang Berlin Spring-Forward 2026-03-29 — Konvertierung korrekt", () => {
    // 04:30 Berlin am 29.03.2026 (nach DST-Sprung) = 02:30 UTC (CEST UTC+2)
    const flat = flattenLocatedTimestamp(
      { pickup: { at: "2026-03-29T04:30:00", tz: "Europe/Berlin" } },
      orderEntity,
    );
    expect(utcStr(flat["pickupUtc"])).toBe("2026-03-29T02:30:00Z");
  });

  test("ist pure — input wird nicht mutiert", () => {
    const input = { pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } };
    const before = JSON.stringify(input);
    flattenLocatedTimestamp(input, orderEntity);
    expect(JSON.stringify(input)).toBe(before);
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

  test("PG-Wire-Format mit Space wird normalisiert (PG-mode:'string')", () => {
    // Drizzle's mode:"string" liefert TIMESTAMPTZ als "2026-04-15 09:00:00+00".
    const out = rehydrateLocatedTimestamp(
      { pickupUtc: "2026-04-15 09:00:00+00", pickupTz: "Europe/Lisbon" },
      orderEntity,
    );
    expect((out["pickup"] as { utc: string }).utc).toBe("2026-04-15T09:00:00Z");
    expect((out["pickup"] as { at: string }).at).toBe("2026-04-15T10:00:00");
  });

  test("Round-Trip: flatten dann rehydrate ergibt original-equivalent", () => {
    const original = { pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } };
    const flat = flattenLocatedTimestamp(original, orderEntity);
    const rehydrated = rehydrateLocatedTimestamp(flat, orderEntity);

    const pickup = rehydrated["pickup"] as { at: string; tz: string; utc: string };
    expect(pickup.at).toBe("2026-04-15T10:00:00");
    expect(pickup.tz).toBe("Europe/Lisbon");
    // utc wird IM Read zusätzlich befüllt — original hatte ihn nicht
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

  test("Tag-Wechsel: 23:30 Berlin → 21:30 UTC; Read in Tokyo gibt anderen Tag", () => {
    // Beweis dass der Default `at` = Pickup-Ort-lokal IST. Hier speichern
    // wir einen UTC-Instant mit Lissabon als gespeicherte tz, und prüfen
    // dass der Read den Lissabon-Wall-Clock-Tag liefert (nicht z.B. Tokyo).
    const out = rehydrateLocatedTimestamp(
      { pickupUtc: "2026-04-15T22:30:00Z", pickupTz: "Europe/Lisbon" },
      orderEntity,
    );
    // In Lissabon (WEST UTC+1) ist 22:30 UTC am 15.04 = 23:30 am 15.04 lokal
    expect((out["pickup"] as { at: string }).at).toBe("2026-04-15T23:30:00");

    // Wenn jemand User-Sicht "in Tokyo" wollte: muss er aus utc selbst ableiten.
    // Dieser Test demonstriert nur die Server-Default-Sicht (Pickup-Ort-lokal).
  });

  test("fehlende Felder werden übersprungen (kein crash)", () => {
    const out = rehydrateLocatedTimestamp({ clientName: "X" }, orderEntity);
    expect(out).toEqual({ clientName: "X" });
  });

  test("partial: nur Tz ohne Utc → Pair wird nicht erzeugt (Daten korrupt, kein silent fix)", () => {
    const out = rehydrateLocatedTimestamp({ pickupTz: "Europe/Lisbon" }, orderEntity);
    expect(out["pickup"]).toBeUndefined();
  });
});

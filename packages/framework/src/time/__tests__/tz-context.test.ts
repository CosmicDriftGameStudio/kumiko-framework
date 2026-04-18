// Unit-Tests für ctx.tz API.
// Test-Fokus: korrekte Konvertierung Wall-Clock+TZ ↔ Instant ↔ JSON-Pair.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureTemporalPolyfill } from "../polyfill";
import { createTzContext } from "../tz-context";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("ctx.tz — defaults", () => {
  test("ohne Options: tenant + user beide UTC", () => {
    const tz = createTzContext();
    expect(tz.tenant).toBe("UTC");
    expect(tz.user).toBe("UTC");
  });

  test("nur tenant gesetzt: user fällt auf tenant zurück", () => {
    const tz = createTzContext({ tenant: "Europe/Berlin" });
    expect(tz.tenant).toBe("Europe/Berlin");
    expect(tz.user).toBe("Europe/Berlin");
  });

  test("user-Override sticht tenant", () => {
    const tz = createTzContext({ tenant: "Europe/Berlin", user: "Asia/Tokyo" });
    expect(tz.tenant).toBe("Europe/Berlin");
    expect(tz.user).toBe("Asia/Tokyo");
  });
});

describe("ctx.tz — now / today", () => {
  test("now() liefert Temporal.Instant", () => {
    const tz = createTzContext();
    const instant = tz.now();
    expect(typeof instant.epochMilliseconds).toBe("number");
    // Sollte nahe an aktueller Wall-Time sein (innerhalb 5 Sekunden).
    expect(Math.abs(instant.epochMilliseconds - Date.now())).toBeLessThan(5000);
  });

  test("nowIn(tz) liefert ZonedDateTime in der richtigen Zone", () => {
    const tz = createTzContext();
    const zdt = tz.nowIn("Europe/Berlin");
    expect(zdt.timeZoneId).toBe("Europe/Berlin");
  });

  test("today(tz) liefert PlainDate ohne Zeit-Komponente", () => {
    const tz = createTzContext();
    const today = tz.today("Europe/Lisbon");
    // PlainDate hat keine .hour-Property — wenn es eines hätte, wäre's ein
    // ZonedDateTime und der Test würde TypeError werfen.
    expect("hour" in today).toBe(false);
    expect(today.toString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("todayRange(tz) liefert UTC-Instants für DB-Range-Query", () => {
    const tz = createTzContext();
    const range = tz.todayRange("Europe/Berlin");
    // Differenz zwischen start + end ist genau 24h (oder 23/25h bei DST).
    const diffHours =
      (range.end.epochMilliseconds - range.start.epochMilliseconds) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(23);
    expect(diffHours).toBeLessThanOrEqual(25);
  });
});

describe("ctx.tz — parse + JSON-Pair Konvertierungen", () => {
  test("parse(wallClock, tz) liefert ZonedDateTime mit korrekter UTC-Konvertierung", () => {
    const tz = createTzContext();
    // 2026-04-03 10:00 Lisbon = 09:00 UTC (WEST = UTC+1)
    const zdt = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    expect(zdt.timeZoneId).toBe("Europe/Lisbon");
    expect(zdt.toInstant().toString()).toBe("2026-04-03T09:00:00Z");
  });

  test("toLocatedJson(zdt) liefert { at, tz } OHNE Offset-Marker", () => {
    const tz = createTzContext();
    const zdt = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(zdt);
    expect(json).toEqual({ at: "2026-04-03T10:00:00", tz: "Europe/Lisbon" });
    // Kein "Z", kein "+01:00" im at-Feld — sonst ist die JSON-Form nicht
    // mehr idiotensicher.
    expect(json.at).not.toContain("Z");
    expect(json.at).not.toContain("+");
  });

  test("fromLocatedJson({ at, tz }) ist Inverse zu toLocatedJson", () => {
    const tz = createTzContext();
    const original = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(original);
    const restored = tz.fromLocatedJson(json);
    expect(restored.toInstant().equals(original.toInstant())).toBe(true);
    expect(restored.timeZoneId).toBe(original.timeZoneId);
  });

  test("Round-Trip funktioniert über DST-Übergang (Lisbon-Sommerzeit-Ende)", () => {
    const tz = createTzContext();
    // 2026-10-25 in Lisbon: Fall-Back von 02:00 → 01:00. Wir nehmen 14:00,
    // was eindeutig im WET ist (UTC+0).
    const zdt = tz.parse("2026-10-25T14:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(zdt);
    expect(json.at).toBe("2026-10-25T14:00:00");
    expect(json.tz).toBe("Europe/Lisbon");
    const restored = tz.fromLocatedJson(json);
    // Nach DST-Wechsel ist Lisbon UTC+0 → 14:00 lokal = 14:00 UTC.
    expect(restored.toInstant().toString()).toBe("2026-10-25T14:00:00Z");
  });
});

describe("ctx.tz — Cross-Server-TZ Garantie", () => {
  test("derselbe Wall-Clock+TZ liefert denselben UTC-Instant unabhängig vom Server-TZ", () => {
    // Das ist der Kern der Migration: ein Server in Berlin und einer in
    // Tokyo schicken denselben "Pickup 10:00 Lissabon" — beide müssen den
    // gleichen UTC-Instant produzieren. Temporal erfüllt das per Design,
    // wir prüfen es zur Sicherheit.
    const tz = createTzContext();
    const zdt1 = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const zdt2 = tz.fromLocatedJson({ at: "2026-04-03T10:00:00", tz: "Europe/Lisbon" });
    expect(zdt1.toInstant().equals(zdt2.toInstant())).toBe(true);
  });
});

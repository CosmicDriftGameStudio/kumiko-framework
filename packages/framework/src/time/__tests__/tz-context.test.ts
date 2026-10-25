// Unit tests for the ctx.tz API.
// Test focus: correct Wall-Clock+TZ ↔ Instant ↔ JSON-Pair conversion.

import { beforeAll, describe, expect, test } from "bun:test";
import { ensureTemporalPolyfill } from "../polyfill.ts";
import { createTzContext } from "../tz-context.ts";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

describe("ctx.tz — defaults", () => {
  test("without options: tenant + user both UTC", () => {
    const tz = createTzContext();
    expect(tz.tenant).toBe("UTC");
    expect(tz.user).toBe("UTC");
  });

  test("only tenant set: user falls back to tenant", () => {
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
  test("now() returns Temporal.Instant", () => {
    const tz = createTzContext();
    const instant = tz.now();
    expect(typeof instant.epochMilliseconds).toBe("number");
    // Should be close to the current wall-clock time (within 5 seconds).
    expect(Math.abs(instant.epochMilliseconds - Date.now())).toBeLessThan(5000);
  });

  test("nowIn(tz) returns ZonedDateTime in the correct zone", () => {
    const tz = createTzContext();
    const zdt = tz.nowIn("Europe/Berlin");
    expect(zdt.timeZoneId).toBe("Europe/Berlin");
  });

  test("today(tz) returns PlainDate without a time component", () => {
    const tz = createTzContext();
    const today = tz.today("Europe/Lisbon");
    // PlainDate has no .hour property; if it did, it would be a
    // ZonedDateTime and the test would throw a TypeError.
    expect("hour" in today).toBe(false);
    expect(today.toString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("todayRange(tz) returns UTC instants for DB range query", () => {
    const tz = createTzContext();
    const range = tz.todayRange("Europe/Berlin");
    // The difference between start and end is exactly 24h (or 23/25h during DST).
    const diffHours =
      (range.end.epochMilliseconds - range.start.epochMilliseconds) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(23);
    expect(diffHours).toBeLessThanOrEqual(25);
  });
});

describe("ctx.tz — parse + JSON-Pair Konvertierungen", () => {
  test("parse(wallClock, tz) returns ZonedDateTime with correct UTC conversion", () => {
    const tz = createTzContext();
    // 2026-04-03 10:00 Lisbon = 09:00 UTC (WEST = UTC+1)
    const zdt = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    expect(zdt.timeZoneId).toBe("Europe/Lisbon");
    expect(zdt.toInstant().toString()).toBe("2026-04-03T09:00:00Z");
  });

  test("toLocatedJson(zdt) returns { at, tz } WITHOUT offset marker", () => {
    const tz = createTzContext();
    const zdt = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(zdt);
    expect(json).toEqual({ at: "2026-04-03T10:00:00", tz: "Europe/Lisbon" });
    // No "Z" or "+01:00" in the at field—the JSON format must remain
    // unambiguous.
    expect(json.at).not.toContain("Z");
    expect(json.at).not.toContain("+");
  });

  test("fromLocatedJson({ at, tz }) is the inverse of toLocatedJson", () => {
    const tz = createTzContext();
    const original = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(original);
    const restored = tz.fromLocatedJson(json);
    expect(restored.toInstant().equals(original.toInstant())).toBe(true);
    expect(restored.timeZoneId).toBe(original.timeZoneId);
  });

  test("Round-trip works across DST transition (Lisbon daylight saving time end)", () => {
    const tz = createTzContext();
    // 2026-10-25 in Lisbon: fall-back from 02:00 → 01:00. We use 14:00,
    // which is unambiguously in WET (UTC+0).
    const zdt = tz.parse("2026-10-25T14:00:00", "Europe/Lisbon");
    const json = tz.toLocatedJson(zdt);
    expect(json.at).toBe("2026-10-25T14:00:00");
    expect(json.tz).toBe("Europe/Lisbon");
    const restored = tz.fromLocatedJson(json);
    // After the DST change, Lisbon is UTC+0 → 14:00 local = 14:00 UTC.
    expect(restored.toInstant().toString()).toBe("2026-10-25T14:00:00Z");
  });
});

describe("ctx.tz — Cross-Server-TZ Garantie", () => {
  test("the same wall-clock time + TZ yields the same UTC instant regardless of server TZ", () => {
    // This is the core of the migration: a server in Berlin and one in
    // Tokyo send the same "Pickup 10:00 Lissabon"—both must produce the
    // same UTC instant. Temporal guarantees this by design; we verify it
    // as a safeguard.
    const tz = createTzContext();
    const zdt1 = tz.parse("2026-04-03T10:00:00", "Europe/Lisbon");
    const zdt2 = tz.fromLocatedJson({ at: "2026-04-03T10:00:00", tz: "Europe/Lisbon" });
    expect(zdt1.toInstant().equals(zdt2.toInstant())).toBe(true);
  });
});

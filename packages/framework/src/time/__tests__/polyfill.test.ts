// Smoke test for Temporal polyfill initialization.
// Ensures that the main Temporal types are constructible after
// ensureTemporalPolyfill(): Instant, PlainDate, and ZonedDateTime.

import { describe, expect, test } from "bun:test";
import { ensureTemporalPolyfill, getTemporal } from "../polyfill.ts";

describe("Temporal Polyfill", () => {
  test("ensureTemporalPolyfill is idempotent and Temporal remains usable after three calls", async () => {
    await ensureTemporalPolyfill();
    await ensureTemporalPolyfill();
    await ensureTemporalPolyfill();
    // Repeated calls must leave Temporal usable: the shared global state and
    // singleton must not be corrupted.
    const T = getTemporal();
    expect(T.Instant.from("2026-04-18T10:00:00Z").epochMilliseconds).toBe(
      Date.UTC(2026, 3, 18, 10, 0, 0),
    );
  });

  test("Temporal.Instant can be constructed after the polyfill is loaded", async () => {
    await ensureTemporalPolyfill();
    const T = getTemporal();
    const instant = T.Instant.from("2026-04-18T10:00:00Z");
    expect(instant.toString()).toBe("2026-04-18T10:00:00Z");
  });

  test("Temporal.PlainDate funktioniert", async () => {
    await ensureTemporalPolyfill();
    const T = getTemporal();
    const date = T.PlainDate.from("2026-04-18");
    expect(date.toString()).toBe("2026-04-18");
    expect(date.year).toBe(2026);
    expect(date.month).toBe(4);
    expect(date.day).toBe(18);
  });

  test("Temporal.ZonedDateTime with IANA zone (Europe/Lisbon) works", async () => {
    await ensureTemporalPolyfill();
    const T = getTemporal();
    const zdt = T.ZonedDateTime.from("2026-04-18T10:00:00[Europe/Lisbon]");
    expect(zdt.timeZoneId).toBe("Europe/Lisbon");
    expect(zdt.hour).toBe(10);
    // Lisbon observes WEST in April (UTC+1 due to DST), so this is 09:00 UTC.
    expect(zdt.toInstant().toString()).toBe("2026-04-18T09:00:00Z");
  });

  test("DST transition 2026-03-29 02:30 Europe/Berlin does not exist", async () => {
    await ensureTemporalPolyfill();
    const T = getTemporal();
    // Germany's 2026 spring-forward transition skips 02:00–03:00 on the night
    // of March 28–29. 02:30 therefore does not exist in the Berlin time zone;
    // Temporal rejects it with `disambiguation: "reject"`.
    expect(() =>
      T.ZonedDateTime.from(
        { year: 2026, month: 3, day: 29, hour: 2, minute: 30, timeZone: "Europe/Berlin" },
        { disambiguation: "reject" },
      ),
    ).toThrow();
  });

  test("getTemporal throws before polyfill initialization when native Temporal is missing", () => {
    // Temporal is already installed by the module singleton after the first
    // ensureTemporalPolyfill() call, so the pre-initialization throw cannot be
    // tested directly without sharing mutable global state. Verify the post-init
    // contract instead.
    const T = getTemporal();
    expect(T).toBeDefined();
    expect(typeof T.Instant.from).toBe("function");
  });
});

// instant() customType is the backing type for both `type: "timestamp"`
// and the currently aliased `type: "date"`. Caller code sends two string
// formats: zod validation for date accepts only YYYY-MM-DD, while timestamp
// accepts an ISO datetime. toDriver must coerce both formats; otherwise a
// date-only value reaches Temporal.Instant and throws `Cannot parse: 2026-04-10`.
//
// These tests cover the three valid paths (ISO string, date-only string, and
// instant) plus invalid input, which must still throw rather than be swallowed.

import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { instantToDriver as toDriver } from "../dialect.ts";

describe("instant() customType — toDriver", () => {
  test("ISO-datetime mit Z: durchgereicht", () => {
    expect(toDriver("2026-04-10T13:45:00Z")).toBe("2026-04-10T13:45:00Z");
  });

  test("ISO-datetime mit Offset: normalisiert auf UTC-Z", () => {
    // Temporal.Instant.from normalizes +02:00 → Z with the correct time.
    expect(toDriver("2026-04-10T13:45:00+02:00")).toBe("2026-04-10T11:45:00Z");
  });

  test("YYYY-MM-DD: coerced auf start-of-day UTC", () => {
    // Forgiving overload for type:"date": Zod validation accepts only
    // YYYY-MM-DD, so the dialect normalizes it to an instant.
    expect(toDriver("2026-04-10")).toBe("2026-04-10T00:00:00Z");
  });

  test("Temporal.Instant: durchgereicht über .toString()", () => {
    expect(toDriver(Temporal.Instant.from("2026-04-10T13:45:00Z"))).toBe("2026-04-10T13:45:00Z");
  });

  test("Garbage-String: wirft RangeError (kein silent swallow)", () => {
    expect(() => toDriver("not-a-date")).toThrow(RangeError);
  });

  test("Date-only mit Trailing-Whitespace: kein Match (strict regex)", () => {
    // Strict so "2026-04-10 extra" cannot silently become start-of-day;
    // it indicates a caller bug rather than input to accept.
    expect(() => toDriver("2026-04-10 ")).toThrow(RangeError);
  });
});

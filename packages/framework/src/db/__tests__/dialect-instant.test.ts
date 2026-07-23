// instant() customType ist der Backing-Type für sowohl `type: "timestamp"`
// als auch (heute aliased) `type: "date"`. Caller-Code schickt aber zwei
// verschiedene String-Formate: zod-validate für date akzeptiert nur
// YYYY-MM-DD, zod-validate für timestamp akzeptiert ISO-datetime. toDriver
// muss BEIDE Formate coercen können — der Mismatch hat einen 500
// internal_error in samples/apps/showcase produziert (Showcase-seed
// schickte YYYY-MM-DD via item:create → dialect.toDriver → Temporal.Instant
// wirft "Cannot parse: 2026-04-10").
//
// Tests pinnen alle drei Pfade (string-iso, date-only-string, instant) +
// die invalid-Probe (echte Garbage muss weiterhin throwen — kein silent
// swallowing).

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { instantToDriver as toDriver } from "../dialect";

describe("instant() customType — toDriver", () => {
  test("ISO-datetime mit Z: durchgereicht", () => {
    expect(toDriver("2026-04-10T13:45:00Z")).toBe("2026-04-10T13:45:00Z");
  });

  test("ISO-datetime mit Offset: normalisiert auf UTC-Z", () => {
    // Temporal.Instant.from normalisiert +02:00 → Z mit korrekter Zeit.
    expect(toDriver("2026-04-10T13:45:00+02:00")).toBe("2026-04-10T11:45:00Z");
  });

  test("YYYY-MM-DD: coerced auf start-of-day UTC", () => {
    // Forgiving overload für type:"date" — Zod-Validation lässt nur
    // YYYY-MM-DD durch, dialect normalisiert auf instant.
    expect(toDriver("2026-04-10")).toBe("2026-04-10T00:00:00Z");
  });

  test("Temporal.Instant: durchgereicht über .toString()", () => {
    expect(toDriver(Temporal.Instant.from("2026-04-10T13:45:00Z"))).toBe("2026-04-10T13:45:00Z");
  });

  test("Garbage-String: wirft RangeError (kein silent swallow)", () => {
    expect(() => toDriver("not-a-date")).toThrow(/Cannot parse/);
  });

  test("Date-only mit Trailing-Whitespace: kein Match (strict regex)", () => {
    // Strict damit "2026-04-10 extra" nicht silently zu start-of-day
    // wird — das ist garantiert ein Caller-Bug, nicht "nett gemeint".
    expect(() => toDriver("2026-04-10 ")).toThrow(/Cannot parse/);
  });
});

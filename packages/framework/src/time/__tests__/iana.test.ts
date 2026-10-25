import { describe, expect, test } from "bun:test";
import { isValidIanaTimeZone } from "../iana.ts";

describe("isValidIanaTimeZone", () => {
  // The five zones in the CI time-zone matrix (timezones.md) must all be valid;
  // otherwise the matrix cannot set them.
  test.each(["UTC", "Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Apia"])(
    "akzeptiert kanonische Zone %s",
    (zone) => {
      expect(isValidIanaTimeZone(zone)).toBe(true);
    },
  );

  test.each(["", "Mars/Phobos", "europe/berlin", "Europe/Berlin ", "GMT+2", "not-a-zone"])(
    "rejects invalid / non-canonical string %p",
    (value) => {
      expect(isValidIanaTimeZone(value)).toBe(false);
    },
  );

  // Intl.supportedValuesOf("timeZone") lists only canonical names; valid IANA aliases
  // are missing even though Intl.DateTimeFormat/Temporal/ctx.tz.parse accept them
  // without issue. A valid alias must not be rejected as "invalid" here, because
  // that would silently break consumers that store alias zones.
  test.each(["US/Pacific", "GMT", "Etc/UTC"])("accepts valid IANA alias %s", (zone) => {
    expect(isValidIanaTimeZone(zone)).toBe(true);
  });

  test("returns consistently across multiple calls (lazy Set cached)", () => {
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Phobos")).toBe(false);
  });
});

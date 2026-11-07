import { describe, expect, test } from "bun:test";
import { validateRelativeTimeFormat } from "../relative-time-format.ts";

describe("validateRelativeTimeFormat", () => {
  test("accepts valid options and ignores other formats", () => {
    expect(() =>
      validateRelativeTimeFormat("p", 'column "at"', {
        format: "relativeTime",
        style: "short",
        absoluteAfterDays: 7,
        withTime: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateRelativeTimeFormat("p", 'column "at"', { format: "timestamp", style: "nope" }),
    ).not.toThrow();
    expect(() => validateRelativeTimeFormat("p", 'column "at"', undefined)).not.toThrow();
  });

  test("rejects a typo'd style, a bad day count and a non-boolean withTime", () => {
    const check = (extra: Record<string, unknown>) => () =>
      validateRelativeTimeFormat("p", 'column "at"', { format: "relativeTime", ...extra });
    expect(check({ style: "shrt" })).toThrow(/column "at" has relativeTime option style shrt/);
    expect(check({ absoluteAfterDays: 0 })).toThrow(/absoluteAfterDays 0/);
    expect(check({ absoluteAfterDays: 2.5 })).toThrow(/absoluteAfterDays 2.5/);
    expect(check({ withTime: "yes" })).toThrow(/withTime yes/);
    expect(check({ timeZone: "Europe/Berln" })).toThrow(/timeZone Europe\/Berln/);
    expect(() =>
      validateRelativeTimeFormat("p", 'column "at"', {
        format: "relativeTime",
        timeZone: "Europe/Berlin",
      }),
    ).not.toThrow();
  });
});

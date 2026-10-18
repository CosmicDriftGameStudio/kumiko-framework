import { describe, expect, test } from "bun:test";
import { formatRelativeWhen } from "../relative-time.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("formatRelativeWhen", () => {
  test("picks the largest unit that fits", () => {
    expect(formatRelativeWhen("2026-10-16T09:00:00Z", NOW)).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-3, "hour"),
    );
    expect(formatRelativeWhen("2026-10-14T12:00:00Z", NOW)).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-2, "day"),
    );
  });

  test("an unparseable value is returned unchanged", () => {
    expect(formatRelativeWhen("not a date", NOW)).toBe("not a date");
  });
});

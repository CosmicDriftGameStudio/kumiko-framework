import { describe, expect, test } from "bun:test";
import { formatDocumentDate } from "../document-values.ts";

describe("formatDocumentDate dateStyle", () => {
  test("long is the default and spells the month", () => {
    expect(formatDocumentDate("2026-01-15", "de-DE")).toBe("15. Januar 2026");
    expect(formatDocumentDate("2026-01-15", "de-DE", { dateStyle: "long" })).toBe(
      "15. Januar 2026",
    );
  });

  test("short prints day, month and a four digit year in the locale's order", () => {
    expect(formatDocumentDate("2026-01-15", "de-DE", { dateStyle: "short" })).toBe("15.01.2026");
    expect(formatDocumentDate("2026-01-15", "en-US", { dateStyle: "short" })).toBe("01/15/2026");
  });

  test("short keeps the date of an offset date-time and of an instant", () => {
    expect(formatDocumentDate("2026-01-15T23:30:00+02:00", "de-DE", { dateStyle: "short" })).toBe(
      "15.01.2026",
    );
    expect(formatDocumentDate("2026-01-15T10:00:00Z", "de-DE", { dateStyle: "short" })).toBe(
      "15.01.2026",
    );
  });

  test("short with a time appends the time of day", () => {
    const text = formatDocumentDate("2026-01-15T10:05:00Z", "de-DE", {
      dateStyle: "short",
      time: true,
    });
    expect(text).toContain("15.01.2026");
    expect(text).toContain("10:05");
  });

  test("a value that is no date stays as it is", () => {
    expect(formatDocumentDate("soon", "de-DE", { dateStyle: "short" })).toBe("soon");
  });
});

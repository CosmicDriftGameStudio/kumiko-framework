import { describe, expect, test } from "bun:test";
import { formatWhen } from "../format-when";

describe("formatWhen", () => {
  test("formats a parseable ISO timestamp", () => {
    expect(formatWhen("2024-01-01T00:00:00.000Z")).not.toBe("2024-01-01T00:00:00.000Z");
  });

  test("falls back to the raw value on an unparseable input", () => {
    expect(formatWhen("garbage")).toBe("garbage");
  });
});

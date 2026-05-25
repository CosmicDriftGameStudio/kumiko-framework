import { describe, expect, test } from "bun:test";
import { addDuration } from "../steps/_duration-utils";

describe("addDuration", () => {
  test("adds ISO duration to base instant", () => {
    const base = "2024-01-01T00:00:00Z";
    const result = addDuration(base, "PT1H");
    expect(result).toBe(Temporal.Instant.from(base).add({ hours: 1 }).toString());
  });

  test("throws on invalid duration", () => {
    expect(() => addDuration("2024-01-01T00:00:00Z", "not-a-duration")).toThrow(
      /Invalid ISO-8601 duration/,
    );
  });
});

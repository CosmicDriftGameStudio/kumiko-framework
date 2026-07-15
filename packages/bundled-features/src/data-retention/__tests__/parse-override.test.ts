import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { parseRetentionOverrideOrNull } from "../_internal/parse-override";

// A mid-test assertion throw skips the trailing `warn.mockRestore()` in that
// test, leaving the spy live for every test after it (551/1) — this backstop
// restores unconditionally regardless of how the test exited.
afterEach(() => {
  const warn = console.warn as unknown as { mockRestore?: () => void };
  warn.mockRestore?.();
});

// DSGVO invariant: corrupt or schema-drifted overrides collapse to null +
// warn, never leak through (schema itself is covered by override-schema.test.ts).

const parse = (raw: string | null) => parseRetentionOverrideOrNull(raw, "tenant-1", "test");

describe("parseRetentionOverrideOrNull", () => {
  test("null / empty / whitespace-only raw → null before any parse", () => {
    expect(parse(null)).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
  });

  test("a valid override returns the parsed, schema-checked object", () => {
    expect(parse('{"keepFor":"30d","strategy":"hardDelete","reference":"completedAt"}')).toEqual({
      keepFor: "30d",
      strategy: "hardDelete",
      reference: "completedAt",
    });
  });

  test("empty object is a valid override (every field optional)", () => {
    expect(parse("{}")).toEqual({});
  });

  test("corrupt JSON returns null without throwing", () => {
    spyOn(console, "warn").mockImplementation(() => {});
    expect(() => parse("{not json")).not.toThrow();
    expect(parse("{not json")).toBeNull();
  });

  test("JSON that parses but violates the schema is dropped to null — never leaked through", () => {
    spyOn(console, "warn").mockImplementation(() => {});
    expect(parse('{"strategy":"delete"}')).toBeNull(); // enum drift
    expect(parse('{"keepFor":"30days"}')).toBeNull(); // keepFor format drift
    expect(parse('{"keepFor":42}')).toBeNull(); // wrong type
    expect(parse('{"unknownKey":1}')).toBeNull(); // strict() rejects extra keys
  });

  test("each dropped value surfaces exactly one operator warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    parse("{not json");
    expect(warn).toHaveBeenCalledTimes(1);
    parse('{"strategy":"delete"}');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

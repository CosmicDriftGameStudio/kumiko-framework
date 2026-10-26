import { describe, expect, test } from "bun:test";
import { parseEventsPruneArgs } from "../events-cli.ts";

describe("parseEventsPruneArgs", () => {
  test("collects repeated --aggregate-type flags in both spellings", () => {
    expect(
      parseEventsPruneArgs(["--aggregate-type", "pattern-file", "--aggregate-type=app-release"]),
    ).toEqual({ ok: true, types: ["pattern-file", "app-release"], apply: false });
  });

  test("--apply switches off the dry run, regardless of position", () => {
    expect(parseEventsPruneArgs(["--apply", "--aggregate-type", "a"])).toEqual({
      ok: true,
      types: ["a"],
      apply: true,
    });
  });

  test("repeated types collapse to one", () => {
    expect(parseEventsPruneArgs(["--aggregate-type", "a", "--aggregate-type", "a"])).toEqual({
      ok: true,
      types: ["a"],
      apply: false,
    });
  });

  test.each([
    ["no type", [], "At least one"],
    ["only --apply", ["--apply"], "At least one"],
    ["flag without value", ["--aggregate-type"], "needs a value"],
    ["flag followed by another flag", ["--aggregate-type", "--apply"], "needs a value"],
    ["empty value", ["--aggregate-type="], "must not be empty"],
    ["blank value", ["--aggregate-type", "  "], "must not be empty"],
    ["unknown flag", ["--aggregate-type", "a", "--aggregate-types", "b"], "Unknown argument"],
    ["stray positional", ["--aggregate-type", "a", "extra"], "Unknown argument"],
  ])("rejects %s", (_name, argv, message) => {
    const parsed = parseEventsPruneArgs(argv);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });
});

import { describe, expect, test } from "vitest";
import { getFlag, getNumberFlag, getStringFlag, parseArgs } from "../arg-parser";

describe("commands/arg-parser", () => {
  test("collects positional args", () => {
    const r = parseArgs(["a", "b", "c"]);
    expect(r.positional).toEqual(["a", "b", "c"]);
    expect(r.flags.size).toBe(0);
  });

  test("--flag is boolean true", () => {
    const r = parseArgs(["--verbose"]);
    expect(getFlag(r, "verbose")).toBe(true);
  });

  test("--no-flag is boolean false", () => {
    const r = parseArgs(["--no-cache"]);
    expect(r.flags.get("cache")).toBe(false);
  });

  test("--key value takes the next arg as value", () => {
    const r = parseArgs(["--out", "dist/"]);
    expect(getStringFlag(r, "out")).toBe("dist/");
    expect(r.positional).toEqual([]);
  });

  test("--key=value inline form", () => {
    const r = parseArgs(["--out=dist/"]);
    expect(getStringFlag(r, "out")).toBe("dist/");
  });

  test("--key followed by another --key is boolean", () => {
    const r = parseArgs(["--verbose", "--dry-run"]);
    expect(getFlag(r, "verbose")).toBe(true);
    expect(getFlag(r, "dry-run")).toBe(true);
  });

  test("getNumberFlag parses int, returns undefined for NaN", () => {
    const r = parseArgs(["--older-than", "30", "--invalid", "abc"]);
    expect(getNumberFlag(r, "older-than")).toBe(30);
    expect(getNumberFlag(r, "invalid")).toBeUndefined();
  });

  test("mixed positional + flags", () => {
    const r = parseArgs(["build", "samples/foo", "--watch", "--out=dist/"]);
    expect(r.positional).toEqual(["build", "samples/foo"]);
    expect(getFlag(r, "watch")).toBe(true);
    expect(getStringFlag(r, "out")).toBe("dist/");
  });
});

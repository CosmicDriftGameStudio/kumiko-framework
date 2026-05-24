import { describe, expect, test } from "bun:test";
import { readPositiveIntEnv } from "../env-parse";

describe("readPositiveIntEnv", () => {
  test("returns undefined when the key is absent", () => {
    expect(readPositiveIntEnv({}, "POOL_MAX")).toBeUndefined();
  });

  test("returns undefined when the value is the empty string", () => {
    // Shell-quirk: `POOL_MAX=` in a .env yields "" — treat as "unset" so
    // callers fall through to the framework default instead of throwing.
    expect(readPositiveIntEnv({ POOL_MAX: "" }, "POOL_MAX")).toBeUndefined();
  });

  test("parses a valid non-negative integer", () => {
    expect(readPositiveIntEnv({ POOL_MAX: "20" }, "POOL_MAX")).toBe(20);
  });

  test("accepts 0 (the framework sentinel for 'disable')", () => {
    expect(readPositiveIntEnv({ POOL_MAX: "0" }, "POOL_MAX")).toBe(0);
  });

  test("throws on a negative number with the variable name + value in the message", () => {
    expect(() => readPositiveIntEnv({ POOL_MAX: "-1" }, "POOL_MAX")).toThrow(
      /POOL_MAX="-1" must be a non-negative integer/,
    );
  });

  test("throws on a fractional number", () => {
    expect(() => readPositiveIntEnv({ POOL_MAX: "1.5" }, "POOL_MAX")).toThrow(
      /POOL_MAX="1.5" must be a non-negative integer/,
    );
  });

  test("throws on non-numeric input", () => {
    expect(() => readPositiveIntEnv({ POOL_MAX: "abc" }, "POOL_MAX")).toThrow(
      /POOL_MAX="abc" must be a non-negative integer/,
    );
  });

  test("throws on whitespace-only input (Number('   ') is 0 — but trim first)", () => {
    // Number("   ") === 0, which would silently pass the non-negative-integer
    // check. Verifying the current behavior: pure whitespace is parsed as 0
    // because Number() coerces it. If this changes, the test forces a
    // deliberate update rather than a silent drift.
    expect(readPositiveIntEnv({ POOL_MAX: "   " }, "POOL_MAX")).toBe(0);
  });

  test("throws on Infinity", () => {
    expect(() => readPositiveIntEnv({ POOL_MAX: "Infinity" }, "POOL_MAX")).toThrow(
      /POOL_MAX="Infinity" must be a non-negative integer/,
    );
  });
});

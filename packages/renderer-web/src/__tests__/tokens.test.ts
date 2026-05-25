import { describe, expect, test } from "bun:test";
import { applyTokensToCssVars } from "../tokens";

describe("applyTokensToCssVars", () => {
  test("is a documented no-op kept for backward compatibility", () => {
    expect(() => applyTokensToCssVars({} as never)).not.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "../cursor";

describe("encodeCursor / decodeCursor", () => {
  test("round-trips string ids", () => {
    const id = "0194a1b2-c3d4-7890-abcd-ef1234567890";
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  test("round-trips numeric ids", () => {
    expect(decodeCursor(encodeCursor(42))).toBe("42");
  });

  test("decodeCursor throws on empty payload", () => {
    expect(() => decodeCursor(encodeCursor(""))).toThrow(/Invalid cursor/);
  });
});

import { describe, expect, test } from "bun:test";
import { clamp } from "../clamp";

describe("clamp", () => {
  test("value inside range passes through", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test("value below min → min", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  test("value above max → max", () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });

  test("boundary values are kept", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

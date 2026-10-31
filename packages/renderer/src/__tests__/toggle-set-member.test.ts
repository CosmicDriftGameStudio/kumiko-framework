import { describe, expect, test } from "bun:test";
import { toggleSetMember } from "../toggle-set-member.ts";

describe("toggleSetMember", () => {
  test("adds a missing value to a new set", () => {
    const original: ReadonlySet<string> = new Set(["a"]);
    const next = toggleSetMember(original, "b");
    expect([...next]).toEqual(["a", "b"]);
    expect([...original]).toEqual(["a"]);
  });

  test("removes a present value without mutating the original", () => {
    const original: ReadonlySet<string> = new Set(["a", "b"]);
    const next = toggleSetMember(original, "a");
    expect([...next]).toEqual(["b"]);
    expect([...original]).toEqual(["a", "b"]);
  });

  test("toggling twice restores the original members", () => {
    const original: ReadonlySet<number> = new Set([1, 2]);
    const roundTrip = toggleSetMember(toggleSetMember(original, 3), 3);
    expect([...roundTrip].sort()).toEqual([1, 2]);
  });
});

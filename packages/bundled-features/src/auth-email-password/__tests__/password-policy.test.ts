import { expect, test } from "bun:test";
import { commonPasswordCount, isCommonPassword, passwordSchema } from "../password-policy.ts";

test("rejects a breach-list password (case-insensitive)", () => {
  expect(isCommonPassword("Password1")).toBe(true);
  expect(passwordSchema.safeParse("password1").success).toBe(false);
});

test("accepts a long unique password", () => {
  expect(passwordSchema.safeParse("aX9-not-in-any-list-42").success).toBe(true);
});

test("still enforces min length", () => {
  expect(passwordSchema.safeParse("tiny").success).toBe(false);
});

test("breach list keeps every entry after whitespace-separated packing", () => {
  expect(commonPasswordCount).toBe(2086);
  for (const entry of ["0.0.0.000", "01234567", "zanzibar", "zxcvbnm1", "zzzzzzzz"]) {
    expect(isCommonPassword(entry)).toBe(true);
  }
});

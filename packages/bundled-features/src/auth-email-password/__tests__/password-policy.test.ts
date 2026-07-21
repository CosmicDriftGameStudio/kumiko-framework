import { expect, test } from "bun:test";
import { isCommonPassword, passwordSchema } from "../password-policy";

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

import { describe, expect, test } from "bun:test";
import { isRecordLocked } from "../screen-helpers.js";

describe("isRecordLocked", () => {
  const lockedWhen = { field: "status", eq: "closed" } as const;

  test("no condition never locks", () => {
    expect(isRecordLocked(undefined, { status: "closed" })).toBe(false);
  });

  test("locks when the condition holds and stays open otherwise", () => {
    expect(isRecordLocked(lockedWhen, { status: "closed" })).toBe(true);
    expect(isRecordLocked(lockedWhen, { status: "open" })).toBe(false);
  });

  test("a row without the condition field is locked (fail closed)", () => {
    expect(isRecordLocked(lockedWhen, { title: "t" })).toBe(true);
    expect(isRecordLocked({ field: "status", ne: "open" }, {})).toBe(true);
  });

  test("a stored null value is a readable state, not a missing field", () => {
    expect(isRecordLocked(lockedWhen, { status: null })).toBe(false);
  });
});

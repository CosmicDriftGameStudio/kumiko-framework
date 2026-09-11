import { describe, expect, test } from "bun:test";
import { evalFieldCondition } from "../screen-helpers";
import type { FieldCondition } from "../types/screen";

describe("evalFieldCondition()", () => {
  test("boolean forms pass through unchanged", () => {
    expect(evalFieldCondition(true, {})).toBe(true);
    expect(evalFieldCondition(false, {})).toBe(false);
  });

  test("eq matches when the field equals the given value", () => {
    const cond: FieldCondition = { field: "status", eq: "active" };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("ne matches when the field differs from the given value", () => {
    const cond: FieldCondition = { field: "status", ne: "archived" };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("in matches when the field is one of the given values", () => {
    const cond: FieldCondition = { field: "status", in: ["draft", "active"] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("notIn matches when the field is none of the given values", () => {
    const cond: FieldCondition = { field: "status", notIn: ["draft", "archived"] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "draft" })).toBe(false);
  });

  test("empty in is always false", () => {
    const cond: FieldCondition = { field: "status", in: [] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(false);
    expect(evalFieldCondition(cond, {})).toBe(false);
  });

  test("empty notIn is always true", () => {
    const cond: FieldCondition = { field: "status", notIn: [] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, {})).toBe(true);
  });

  test("a missing field is undefined — in false, notIn true", () => {
    const values: Record<string, unknown> = {};
    expect(evalFieldCondition({ field: "status", in: ["active"] }, values)).toBe(false);
    expect(evalFieldCondition({ field: "status", notIn: ["active"] }, values)).toBe(true);
  });
});

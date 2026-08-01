import { describe, expect, test } from "bun:test";
import { mergeSearchParamsIntoInitial } from "../app/kumiko-screen";

type FieldDef = { type?: string; default?: unknown; sensitive?: boolean };

describe("mergeSearchParamsIntoInitial", () => {
  test("raw string param merges in as-is for a text field", () => {
    const fields: Record<string, FieldDef> = { name: { type: "text" } };
    const result = mergeSearchParamsIntoInitial(fields, { name: "Alice" });
    expect(result["name"]).toBe("Alice");
  });

  test("number-type field coerces a numeric string", () => {
    const fields: Record<string, FieldDef> = { age: { type: "number" } };
    const result = mergeSearchParamsIntoInitial(fields, { age: "42" });
    expect(result["age"]).toBe(42);
  });

  test("invalid number string falls back to field default", () => {
    const fields: Record<string, FieldDef> = { count: { type: "number", default: 7 } };
    const result = mergeSearchParamsIntoInitial(fields, { count: "not-a-number" });
    expect(result["count"]).toBe(7);
  });

  test("boolean field coerces 'true' and 'false'", () => {
    const fields: Record<string, FieldDef> = { active: { type: "boolean" } };
    expect(mergeSearchParamsIntoInitial(fields, { active: "true" })["active"]).toBe(true);
    expect(mergeSearchParamsIntoInitial(fields, { active: "false" })["active"]).toBe(false);
  });

  test("sensitive field is skipped even when a matching searchParam exists", () => {
    const fields: Record<string, FieldDef> = { password: { type: "text", sensitive: true } };
    const result = mergeSearchParamsIntoInitial(fields, { password: "secret" });
    expect(result["password"]).toBe("");
  });

  test("field with no matching searchParam keeps its buildInitialValues default", () => {
    const fields: Record<string, FieldDef> = { total: { type: "number", default: 100 } };
    const result = mergeSearchParamsIntoInitial(fields, {});
    expect(result["total"]).toBe(100);
  });

  test("money-type field coerces a numeric string", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" });
    expect(result["price"]).toBe(19.99);
  });

  test("renderableFields set given: searchParam for a non-rendered field is ignored (#1708)", () => {
    const fields: Record<string, FieldDef> = {
      status: { type: "text", default: "draft" },
      ownerId: { type: "text" },
    };
    const result = mergeSearchParamsIntoInitial(
      fields,
      { status: "approved", ownerId: "user-123" },
      new Set(["status"]),
    );
    expect(result["status"]).toBe("approved");
    expect(result["ownerId"]).toBe("");
  });

  test("no renderableFields set given (undefined): behaves as before, all fields eligible", () => {
    const fields: Record<string, FieldDef> = { ownerId: { type: "text" } };
    const result = mergeSearchParamsIntoInitial(fields, { ownerId: "user-123" });
    expect(result["ownerId"]).toBe("user-123");
  });
});

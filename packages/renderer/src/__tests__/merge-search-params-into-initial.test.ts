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

  test("money-type field without a defaultCurrency coerces a bare numeric string (legacy callers, e.g. config-edit/action-form)", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" });
    expect(result["price"]).toBe(19.99);
  });

  test("money-type field WITH a defaultCurrency merges the entityEdit payload shape (#1923)", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" }, undefined, "USD");
    expect(result["price"]).toEqual({ amount: 19.99, currency: "USD" });
  });

  test("money-type field WITH a defaultCurrency but no matching searchParam still defaults to the object shape", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, {}, undefined, "USD");
    expect(result["price"]).toEqual({ amount: 0, currency: "USD" });
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

  test("multiSelect coerces comma-separated searchParam to string[]", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(mergeSearchParamsIntoInitial(fields, { roles: "TenantAdmin" })["roles"]).toEqual([
      "TenantAdmin",
    ]);
    expect(mergeSearchParamsIntoInitial(fields, { roles: "Admin,User" })["roles"]).toEqual([
      "Admin",
      "User",
    ]);
  });

  test("multiSelect coerces JSON-array searchParam to string[]", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(
      mergeSearchParamsIntoInitial(fields, { roles: JSON.stringify(["Admin", "Editor"]) })[
        "roles"
      ],
    ).toEqual(["Admin", "Editor"]);
  });

  test("multiSelect defaults to [] when unset", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(mergeSearchParamsIntoInitial(fields, {})["roles"]).toEqual([]);
  });
});

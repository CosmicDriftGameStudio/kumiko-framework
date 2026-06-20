import { describe, expect, test } from "bun:test";
import { fieldWriteAccessDeniedRoles } from "../lib/field-access";
import type { SerializedFieldShape } from "../lib/parse-serialized-field";

function field(write?: ReadonlyArray<string>): SerializedFieldShape {
  return { type: "text", ...(write ? { fieldAccess: { write } } : {}) };
}

describe("fieldWriteAccessDeniedRoles", () => {
  test("allows (null) when the definition is absent", () => {
    expect(fieldWriteAccessDeniedRoles(null, ["Viewer"])).toBeNull();
  });

  test("allows (null) when no write restriction is declared", () => {
    expect(fieldWriteAccessDeniedRoles(field(), ["Viewer"])).toBeNull();
    expect(fieldWriteAccessDeniedRoles(field([]), ["Viewer"])).toBeNull();
  });

  test("allows when a user role intersects the required roles", () => {
    expect(
      fieldWriteAccessDeniedRoles(field(["TenantAdmin"]), ["Viewer", "TenantAdmin"]),
    ).toBeNull();
  });

  test("returns the required roles when the user lacks them", () => {
    expect(fieldWriteAccessDeniedRoles(field(["TenantAdmin"]), ["Viewer"])).toEqual([
      "TenantAdmin",
    ]);
  });

  test("match is exact — a drifted role name (Admin vs TenantAdmin) denies", () => {
    expect(fieldWriteAccessDeniedRoles(field(["TenantAdmin"]), ["Admin"])).toEqual(["TenantAdmin"]);
  });
});

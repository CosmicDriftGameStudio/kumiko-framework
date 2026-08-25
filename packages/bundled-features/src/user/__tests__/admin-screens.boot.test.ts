import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant/feature";
import { createUserFeature } from "../feature";

// The SystemAdmin platform screens (entityList + entityEdit for user/tenant)
// must live IN the user/tenant features — the boot-validator forbids
// cross-feature screen ownership. The validator checks screen STRUCTURE
// (entity-local, columns/fields exist, rowAction targets resolve) but NOT that
// an entityEdit has a matching update/detail handler. That convention-QN wiring
// is the load-bearing part here, so it is asserted explicitly.
//
// QN convention (collectWriteHandlerQns / collectScreenQns): a handler keyed
// "<short>" in feature "<f>" resolves to "<f>:<kind>:<short>". entityList loads
// "<f>:query:<entity>:list", entityEdit loads "<f>:query:<entity>:detail" and
// saves via "<f>:write:<entity>:{create,update}".

describe("user + tenant SystemAdmin admin screens", () => {
  const features = [createConfigFeature(), createUserFeature(), createTenantFeature()];

  test("the assembled feature set boot-validates", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("user feature ships SystemAdmin-gated list + edit screens", () => {
    const user = createUserFeature();
    expect(Object.keys(user.screens)).toEqual(expect.arrayContaining(["user-list", "user-edit"]));
    const list = user.screens["user-list"];
    expect(list?.type).toBe("entityList");
    expect(list?.access).toEqual({ roles: ["SystemAdmin"] });
    expect(user.screens["user-edit"]?.type).toBe("entityEdit");
  });

  test("user-edit layout includes roles (multiSelect) so SystemAdmin can promote peers", () => {
    const user = createUserFeature();
    const edit = user.screens["user-edit"];
    expect(edit?.type).toBe("entityEdit");
    if (edit?.type !== "entityEdit") throw new Error("expected entityEdit");
    const fieldNames = edit.layout.sections.flatMap((s) =>
      "fields" in s ? s.fields.map((f) => (typeof f === "string" ? f : f.field)) : [],
    );
    expect(fieldNames).toContain("roles");
    expect(user.entities?.["user"]?.fields["roles"]?.type).toBe("multiSelect");
  });

  test("user-list columns include roles and tenants for the platform roster", () => {
    const user = createUserFeature();
    const list = user.screens["user-list"];
    expect(list?.type).toBe("entityList");
    if (list?.type !== "entityList") throw new Error("expected entityList");
    const cols = list.columns.map((c) => (typeof c === "string" ? c : c.field));
    expect(cols).toEqual(expect.arrayContaining(["roles", "tenants", "email"]));
    expect(user.entities?.["user"]?.derivedFields?.["tenants"]).toBeDefined();
  });

  test("user list/detail/create/update handlers already sit on the screen QNs", () => {
    const user = createUserFeature();
    // → user:query:user:list, user:query:user:detail
    expect(Object.keys(user.queryHandlers)).toEqual(
      expect.arrayContaining(["user:list", "user:detail"]),
    );
    // → user:write:user:update (entityEdit save), user:write:user:create ("+ New")
    expect(Object.keys(user.writeHandlers)).toEqual(
      expect.arrayContaining(["user:update", "user:create"]),
    );
  });

  test("tenant feature ships list + edit screens (edit-only, no hard delete)", () => {
    const tenant = createTenantFeature();
    expect(Object.keys(tenant.screens)).toEqual(
      expect.arrayContaining(["tenant-list", "tenant-edit"]),
    );
    const edit = tenant.screens["tenant-edit"];
    expect(edit?.type).toBe("entityEdit");
    if (edit?.type === "entityEdit") {
      expect(edit.allowCreate).toBe(false);
      expect(edit.allowDelete).toBe(false);
    }
  });

  test("tenant gains entity-convention handlers without dropping the legacy ones", () => {
    const tenant = createTenantFeature();
    // New: entityList/entityEdit resolve tenant:query:tenant:{list,detail} +
    // tenant:write:tenant:update (the legacy handlers are keyed "list"/"update"
    // → tenant:query:list / tenant:write:update, which the convention misses).
    expect(Object.keys(tenant.queryHandlers)).toEqual(
      expect.arrayContaining(["tenant:list", "tenant:detail"]),
    );
    expect(Object.keys(tenant.writeHandlers)).toContain("tenant:update");
    // Legacy handlers stay for existing callers (no rename = no break).
    expect(Object.keys(tenant.queryHandlers)).toContain("list");
    expect(Object.keys(tenant.writeHandlers)).toContain("update");
  });
});

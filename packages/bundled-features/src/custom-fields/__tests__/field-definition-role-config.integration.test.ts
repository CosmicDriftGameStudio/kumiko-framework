// #2296 — role-configurability of the definition-CRUD triad (define-/update-/
// delete-tenant-field), which was hard-wired to ["TenantAdmin"] with no override.
// Verifies createCustomFieldsFeature({ fieldDefinitionWriteRoles }) actually
// gates all three handlers with the configured roles (not just define), that the
// default-role user loses access once the override is set (Role-Naming-Drift is
// real, not just documented), and that a definer without an explicit
// fieldDefinitionListRoles override can still list what they defined.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";

const admin = createTestUser({ roles: ["TenantAdmin"] });
const customRoleUser = createTestUser({ roles: ["Admin"] });

function defPayload(fieldKey: string) {
  return {
    entityName: "customer",
    fieldKey,
    serializedField: { type: "text" },
    required: false,
    searchable: false,
    displayOrder: 0,
  };
}

describe("custom-fields — fieldDefinitionWriteRoles (#2296)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [createCustomFieldsFeature({ fieldDefinitionWriteRoles: ["Admin"] })],
    });
    await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
    await createEventsTable(stack.db);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe("DELETE FROM read_custom_field_definitions");
  });

  test("a custom-role user can define, update and delete a tenant field definition", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      defPayload("vip"),
      customRoleUser,
    );
    const afterDefine = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "custom-fields:query:field-definition:list",
      {},
      customRoleUser,
    );
    const defined = afterDefine.rows.find((r) => r["fieldKey"] === "vip");
    expect(defined).toBeDefined();
    expect(defined?.["searchable"]).toBe(false);

    await stack.http.writeOk(
      "custom-fields:write:update-tenant-field",
      { ...defPayload("vip"), searchable: true },
      customRoleUser,
    );
    const afterUpdate = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "custom-fields:query:field-definition:list",
      {},
      customRoleUser,
    );
    const updated = afterUpdate.rows.find((r) => r["fieldKey"] === "vip");
    expect(updated?.["searchable"]).toBe(true);

    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "customer", fieldKey: "vip" },
      customRoleUser,
    );
    const afterDelete = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "custom-fields:query:field-definition:list",
      {},
      customRoleUser,
    );
    expect(afterDelete.rows.some((r) => r["fieldKey"] === "vip")).toBe(false);
  });

  test("the default TenantAdmin role is denied on all three once fieldDefinitionWriteRoles overrides it", async () => {
    const defineDenied = await stack.http.writeErr(
      "custom-fields:write:define-tenant-field",
      defPayload("vip2"),
      admin,
    );
    expect(defineDenied.httpStatus).toBe(403);

    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      defPayload("vip2"),
      customRoleUser,
    );

    const updateDenied = await stack.http.writeErr(
      "custom-fields:write:update-tenant-field",
      { ...defPayload("vip2"), searchable: true },
      admin,
    );
    expect(updateDenied.httpStatus).toBe(403);

    const deleteDenied = await stack.http.writeErr(
      "custom-fields:write:delete-tenant-field",
      { entityName: "customer", fieldKey: "vip2" },
      admin,
    );
    expect(deleteDenied.httpStatus).toBe(403);
  });

  test("a definer without an explicit fieldDefinitionListRoles override can list their own definitions", async () => {
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      defPayload("vip3"),
      customRoleUser,
    );

    const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "custom-fields:query:field-definition:list",
      {},
      customRoleUser,
    );
    expect(list.rows.some((r) => r["fieldKey"] === "vip3")).toBe(true);
  });
});

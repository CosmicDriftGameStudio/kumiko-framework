import { describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { EventUpcastCtx } from "@cosmicdrift/kumiko-types/handlers";
import { fieldDefinitionDeletedSchema } from "../events.ts";
import { createCustomFieldsFeature } from "../feature.ts";
import { FIELD_DEFINITION_DELETED_EVENT } from "../web/constants.ts";

const STORED_TENANT = testTenantId(7);

function upcastCtxFor(tenantId: EventUpcastCtx["tenantId"]): EventUpcastCtx {
  return { tenantId } as EventUpcastCtx;
}

async function upcastFromVersion1(payload: unknown, ctx: EventUpcastCtx): Promise<unknown> {
  const step = createCustomFieldsFeature().eventMigrations[FIELD_DEFINITION_DELETED_EVENT]?.find(
    (migration) => migration.fromVersion === 1,
  );
  if (!step) throw new Error("field-definition-deleted has no v1 migration");
  return step.transform(payload, ctx);
}

describe("field-definition-deleted upcast", () => {
  test("a v1 event without tenantId takes the tenant of the stored event and then parses", async () => {
    const oldPayload = { entityName: "property", fieldKey: "priority" };
    expect(() => fieldDefinitionDeletedSchema.parse(oldPayload)).toThrow();

    const upcast = await upcastFromVersion1(oldPayload, upcastCtxFor(STORED_TENANT));

    expect(fieldDefinitionDeletedSchema.parse(upcast)).toEqual({
      entityName: "property",
      fieldKey: "priority",
      tenantId: STORED_TENANT,
    });
  });

  test("a v1 event from the system scope keeps the cross-tenant cleanup scope", async () => {
    const upcast = await upcastFromVersion1(
      { entityName: "property", fieldKey: "priority" },
      upcastCtxFor(SYSTEM_TENANT_ID),
    );

    expect(fieldDefinitionDeletedSchema.parse(upcast).tenantId).toBe(SYSTEM_TENANT_ID);
  });

  test("a v1 event that already names its tenant keeps it", async () => {
    const payload = { entityName: "property", fieldKey: "priority", tenantId: "payload-tenant" };

    const upcast = await upcastFromVersion1(payload, upcastCtxFor(STORED_TENANT));

    expect(upcast).toEqual(payload);
  });
});

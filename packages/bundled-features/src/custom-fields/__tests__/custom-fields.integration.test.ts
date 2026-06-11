// T1 — full-stack integration tests for the custom-fields bundle.
//
// Drives define→set→query→clear→delete-cascade through the real dispatcher +
// MSP-pipeline + DB. Verifies that the architecture actually works end-to-end:
//   - r.defineEvent fires + MSP consumes + jsonb-projection lands
//   - postQuery-entity-hook flattens customFields auf API-root
//   - fieldDefinition-delete cascade-cleans orphan jsonb-keys
//   - Multi-tenant isolation
//
// Pattern follows cap-counter.integration.ts: probe-feature mit own entity,
// wired via wireCustomFieldsFor.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineEntityListHandler,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

// --- Probe-Feature: a tenant-owned "property" entity with customFields ---

const propertyEntity = createEntity({
  table: "read_t1_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable("property", propertyEntity);

const propertyFeature = defineFeature("property-test", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);

  // Standard CRUD: create + list via entity-handlers. Pure test-probe.
  const { executor: propertyExecutor } = createEntityExecutor("property", propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string; name: string };
      return propertyExecutor.create(
        { id: payload.id, name: payload.name, customFields: {} },
        event.user,
        ctx.db,
      );
    },
  });

  r.queryHandler(
    defineEntityListHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

// --- Stack ---

const customFieldsFeature = createCustomFieldsFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [customFieldsFeature, propertyFeature],
  });

  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Clean slate per test — event-log + entity-rows.
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t1_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
});

// --- Helpers ---

// TestUsers.admin hat role="Admin"; unsere handlers verlangen "TenantAdmin"
// (Memory: feedback_role_naming_drift — bundled-features-Convention vs.
// platform-Convention). Wir bauen einen tenant-admin für die Tests.
const admin = createTestUser({ roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ roles: ["SystemAdmin"] });

async function countDefinitions(tenantId: string, fieldKey: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT count(*)::int AS n FROM read_custom_field_definitions WHERE tenant_id = $1 AND field_key = $2",
    [tenantId, fieldKey],
  );
  return (rows as ReadonlyArray<{ n: number }>)[0]?.n ?? 0;
}

async function fetchDefinitionRow(
  tenantId: string,
  fieldKey: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT entity_name, field_key, type, required, searchable, display_order, serialized_field FROM read_custom_field_definitions WHERE tenant_id = $1 AND field_key = $2",
    [tenantId, fieldKey],
  );
  return (rows as ReadonlyArray<Record<string, unknown>>)[0];
}

async function defineField(entityName: string, fieldKey: string, type = "text") {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName,
      fieldKey,
      serializedField: { type },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function setCustomField(
  entityName: string,
  entityId: string,
  fieldKey: string,
  value: unknown,
) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName, entityId, fieldKey, value },
    admin,
  );
}

async function clearCustomField(entityName: string, entityId: string, fieldKey: string) {
  return stack.http.writeOk(
    "custom-fields:write:clear-custom-field",
    { entityName, entityId, fieldKey },
    admin,
  );
}

async function createProperty(id: string, name: string) {
  return stack.http.writeOk("property-test:write:property:create", { id, name }, admin);
}

async function listProperties() {
  return (await stack.http.queryOk("property-test:query:property:list", {}, admin)) as {
    rows: Array<Record<string, unknown>>;
  };
}

// --- Tests ---

describe("custom-fields integration — define + set + query roundtrip", () => {
  test("set → MSP → postQuery: customField value lands flat in entity response", async () => {
    await defineField("property", "internalNumber");
    await createProperty("11111111-1111-4000-8000-000000000001", "Hofgarten 12");
    await setCustomField(
      "property",
      "11111111-1111-4000-8000-000000000001",
      "internalNumber",
      "X-2042",
    );

    await stack.eventDispatcher?.runOnce();

    const { rows } = await listProperties();
    const p1 = rows.find((r) => r["id"] === "11111111-1111-4000-8000-000000000001");
    expect(p1).toBeDefined();
    expect(p1?.["internalNumber"]).toBe("X-2042");
  });

  test("clear: fieldKey gone from response after clear-custom-field", async () => {
    await defineField("property", "vipFlag", "boolean");
    await createProperty("22222222-2222-4000-8000-000000000002", "BookStore");
    await setCustomField("property", "22222222-2222-4000-8000-000000000002", "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    let p2 = (await listProperties()).rows.find(
      (r) => r["id"] === "22222222-2222-4000-8000-000000000002",
    );
    expect(p2?.["vipFlag"]).toBe(true);

    await clearCustomField("property", "22222222-2222-4000-8000-000000000002", "vipFlag");
    await stack.eventDispatcher?.runOnce();

    p2 = (await listProperties()).rows.find(
      (r) => r["id"] === "22222222-2222-4000-8000-000000000002",
    );
    expect(p2?.["vipFlag"]).toBeUndefined();
  });

  test("multiple fields on same entity: all merge flat", async () => {
    await defineField("property", "vendor");
    await defineField("property", "tier", "number");
    await createProperty("33333333-3333-4000-8000-000000000003", "MultiField");
    await setCustomField("property", "33333333-3333-4000-8000-000000000003", "vendor", "Hetzner");
    await setCustomField("property", "33333333-3333-4000-8000-000000000003", "tier", 2);

    await stack.eventDispatcher?.runOnce();

    const p3 = (await listProperties()).rows.find(
      (r) => r["id"] === "33333333-3333-4000-8000-000000000003",
    );
    expect(p3?.["vendor"]).toBe("Hetzner");
    expect(p3?.["tier"]).toBe(2);
  });

  test("entity without customField values: still queryable (no postQuery breakage)", async () => {
    await createProperty("44444444-4444-4000-8000-000000000004", "NoCustomFields");

    const p4 = (await listProperties()).rows.find(
      (r) => r["id"] === "44444444-4444-4000-8000-000000000004",
    );
    expect(p4?.["name"]).toBe("NoCustomFields");
  });
});

describe("custom-fields integration — fieldDefinition-delete cascade", () => {
  test("fieldDef-delete: orphan values removed from all entity-rows", async () => {
    await defineField("property", "ephemeral");
    await createProperty("55555555-5555-4000-8000-000000000005", "WillLoseField");
    await setCustomField("property", "55555555-5555-4000-8000-000000000005", "ephemeral", "doomed");
    await stack.eventDispatcher?.runOnce();

    let p5 = (await listProperties()).rows.find(
      (r) => r["id"] === "55555555-5555-4000-8000-000000000005",
    );
    expect(p5?.["ephemeral"]).toBe("doomed");

    // Delete fieldDef — cascade-MSP entfernt jsonb-key aus allen rows
    await stack.http.writeOk(
      "custom-fields:write:delete-tenant-field",
      { entityName: "property", fieldKey: "ephemeral" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    p5 = (await listProperties()).rows.find(
      (r) => r["id"] === "55555555-5555-4000-8000-000000000005",
    );
    expect(p5?.["ephemeral"]).toBeUndefined();
    expect(p5?.["name"]).toBe("WillLoseField"); // Stammfeld unverändert
  });
});

describe("custom-fields integration — Last-Wins on concurrent set", () => {
  test("two sequential sets on same field: last value wins", async () => {
    await defineField("property", "status");
    await createProperty("66666666-6666-4000-8000-000000000006", "StatusEntity");

    await setCustomField("property", "66666666-6666-4000-8000-000000000006", "status", "draft");
    await setCustomField("property", "66666666-6666-4000-8000-000000000006", "status", "published");
    await stack.eventDispatcher?.runOnce();

    const p6 = (await listProperties()).rows.find(
      (r) => r["id"] === "66666666-6666-4000-8000-000000000006",
    );
    expect(p6?.["status"]).toBe("published");
  });
});

describe("custom-fields integration — define/delete handler coverage (B1)", () => {
  // feature.test.ts only covers schema/aggregate-id/registration shape. These
  // drive the handler bodies through the real dispatcher: the deterministic
  // aggregate-id → version_conflict on a duplicate define, the system-tenant
  // guard on define-tenant-field, and the system-scope define→delete roundtrip.

  test("re-defining the same tenant-field → 409 (deterministic aggregate-id conflict)", async () => {
    await defineField("property", "color", "text");
    const err = await stack.http.writeErr(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "color",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    expect(err.httpStatus).toBe(409);
    // Only the first define produced a row.
    expect(await countDefinitions(admin.tenantId, "color")).toBe(1);
  });

  test("define-tenant-field rejects a caller whose tenant IS the system tenant", async () => {
    // The strict guard (isSystemTenant) blocks system-scope writes through the
    // tenant handler — system definitions must go via define-system-field.
    const systemScopedAdmin = createTestUser({
      roles: ["TenantAdmin"],
      tenantId: SYSTEM_TENANT_ID,
    });
    const err = await stack.http.writeErr(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "leaky",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      systemScopedAdmin,
    );
    // The guard throws a plain Error → 500 internal_error. Pin the guard's own
    // message (surfaced as the InternalError cause in test/dev) so this can't
    // be satisfied by some unrelated 5xx that also happens to write no row.
    expect(err.httpStatus).toBe(500);
    expect(err.code).toBe("internal_error");
    const causeMessage = (err.details as { causeMessage?: string } | undefined)?.causeMessage ?? "";
    expect(causeMessage).toContain("define-system-field");
    expect(await countDefinitions(SYSTEM_TENANT_ID, "leaky")).toBe(0);
  });

  test("define-system-field → delete-system-field roundtrip (SystemAdmin, system scope)", async () => {
    const defineRes = await stack.http.writeOk(
      "custom-fields:write:define-system-field",
      {
        entityName: "property",
        fieldKey: "vendorTag",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      systemAdmin,
    );
    expect(defineRes).toBeDefined();
    expect(await countDefinitions(SYSTEM_TENANT_ID, "vendorTag")).toBe(1);
    await stack.http.writeOk(
      "custom-fields:write:delete-system-field",
      { entityName: "property", fieldKey: "vendorTag" },
      systemAdmin,
    );
    expect(await countDefinitions(SYSTEM_TENANT_ID, "vendorTag")).toBe(0);
  });
});

describe("custom-fields integration — value validation (Builder-Reuse)", () => {
  async function setErr(entityId: string, fieldKey: string, value: unknown) {
    return stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId, fieldKey, value },
      admin,
    );
  }

  async function countSetEvents(entityId: string): Promise<number> {
    const rows = await asRawClient(stack.db).unsafe(
      "SELECT count(*)::int AS n FROM kumiko_events WHERE aggregate_id = $1 AND type = $2",
      [entityId, "custom-fields:event:custom-field-set"],
    );
    return (rows as ReadonlyArray<{ n: number }>)[0]?.n ?? 0;
  }

  async function rawCustomFields(entityId: string): Promise<Record<string, unknown>> {
    const rows = await asRawClient(stack.db).unsafe(
      "SELECT custom_fields FROM read_t1_properties WHERE id = $1",
      [entityId],
    );
    const cf = (rows as ReadonlyArray<{ custom_fields: unknown }>)[0]?.custom_fields;
    return cf && typeof cf === "object" && !Array.isArray(cf)
      ? (cf as Record<string, unknown>)
      : {};
  }

  test("type mismatch → 422, no event emitted, no jsonb key after projection", async () => {
    const id = "77777777-7777-4000-8000-000000000007";
    await defineField("property", "count", "number");
    await createProperty(id, "TypeMismatch");

    const err = await setErr(id, "count", "not-a-number");
    expect(err.httpStatus).toBe(422);
    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({ reason: "custom_field_value_invalid" });

    // Plan-Promise: kein Event entsteht — Projection bleibt typed.
    expect(await countSetEvents(id)).toBe(0);

    await stack.eventDispatcher?.runOnce();
    expect(await rawCustomFields(id)).not.toHaveProperty("count");
  });

  test("matching values pass — number/text/boolean land correctly", async () => {
    const id = "88888888-8888-4000-8000-000000000008";
    await defineField("property", "count", "number");
    await defineField("property", "label", "text");
    await defineField("property", "active", "boolean");
    await createProperty(id, "Valid");

    await setCustomField("property", id, "count", 42);
    await setCustomField("property", id, "label", "ok");
    await setCustomField("property", id, "active", true);
    await stack.eventDispatcher?.runOnce();

    const row = (await listProperties()).rows.find((r) => r["id"] === id);
    expect(row?.["count"]).toBe(42);
    expect(row?.["label"]).toBe("ok");
    expect(row?.["active"]).toBe(true);
  });

  test("boolean field rejects a string value → 422, no event", async () => {
    const id = "99999999-9999-4000-8000-000000000009";
    await defineField("property", "flag", "boolean");
    await createProperty(id, "BoolReject");

    const err = await setErr(id, "flag", "yes");
    expect(err.httpStatus).toBe(422);
    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({ reason: "custom_field_value_invalid" });
    expect(await countSetEvents(id)).toBe(0);
  });

  test("required-text accepts empty + over-maxLength strings (constraint-keys stripped)", async () => {
    const id = "bbbbbbbb-bbbb-4000-8000-00000000000b";
    // serializedField carries required + maxLength + format — value-schema
    // strips these before fieldToZod, so the runtime schema collapses to a
    // bare z.string(). Required-on-set + length/format-enforcement remain
    // out-of-scope (Plan-Doc "Stammfeld-Identität").
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "note",
        serializedField: { type: "text", required: true, maxLength: 5, format: "email" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    await createProperty(id, "TypeOnly");

    await setCustomField("property", id, "note", "");
    await setCustomField("property", id, "note", "not-an-email-and-way-too-long");
    await stack.eventDispatcher?.runOnce();

    expect(await rawCustomFields(id)).toMatchObject({ note: "not-an-email-and-way-too-long" });
  });

  test("default-having field validates as plain type (default-key stripped)", async () => {
    const id = "cccccccc-cccc-4000-8000-00000000000c";
    // Pre-fix: fieldToZod folded `default` into `.default(...)`. Combined with
    // emitting `payload.value` (not `parsed.data`) the in-code path would skip
    // the type-check for a missing value. value-schema now strips `default`
    // before fieldToZod so the runtime schema is bare `z.number()` — matching
    // values still pass, type-mismatches still 422.
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "score",
        serializedField: { type: "number", default: 0 },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    await createProperty(id, "DefaultStripped");

    const err = await setErr(id, "score", "not-a-number");
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ reason: "custom_field_value_invalid" });
    expect(await countSetEvents(id)).toBe(0);

    await setCustomField("property", id, "score", 7);
    await stack.eventDispatcher?.runOnce();
    expect(await rawCustomFields(id)).toMatchObject({ score: 7 });
  });

  async function setMissingValueErr(entityId: string, fieldKey: string) {
    // value omitted entirely — JSON drops undefined, so the payload arrives
    // without `value` and the schema-level refine rejects it.
    return stack.http.writeErr(
      "custom-fields:write:set-custom-field",
      { entityName: "property", entityId, fieldKey },
      admin,
    );
  }

  test("missing value → 400 validation_error, no event (set requires a value)", async () => {
    // The payload refine (set-custom-field.write.ts) rejects a missing value
    // before the handler runs — otherwise `undefined` would bind as a jsonb
    // NULL against the NOT-NULL custom_fields column. clear-custom-field is the
    // documented way to remove a value.
    const id = "11111111-2222-4000-8000-00000000000e";
    await defineField("property", "label", "text");
    await createProperty(id, "MissingValue");

    const err = await setMissingValueErr(id, "label");
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.details).toMatchObject({ fields: [{ path: "value" }] });
    expect(await countSetEvents(id)).toBe(0);
  });

  test("default-having field: a missing value is still rejected (default not silently applied)", async () => {
    // Pre-fix bug: `z.number().default(0).safeParse(undefined)` succeeded with
    // data=0, and the handler emitted `payload.value` (= undefined). The refine
    // now rejects the missing value outright — no event, no defaulted-undefined.
    const id = "22222222-3333-4000-8000-00000000000f";
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "rank",
        serializedField: { type: "number", default: 0 },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    await createProperty(id, "DefaultMissing");

    const err = await setMissingValueErr(id, "rank");
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(await countSetEvents(id)).toBe(0);
  });

  test("embedded field rejects a non-object value → 422, no event", async () => {
    const id = "aaaaaaaa-aaaa-4000-8000-00000000000a";
    // embedded carries a sub-field schema in serializedField — exercises
    // fieldToZod's z.object(...) dispatch (the structurally complex path).
    await stack.http.writeOk(
      "custom-fields:write:define-tenant-field",
      {
        entityName: "property",
        fieldKey: "geo",
        serializedField: { type: "embedded", schema: { city: { type: "text", required: true } } },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    await createProperty(id, "EmbeddedReject");

    const err = await setErr(id, "geo", "not-an-object");
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ reason: "custom_field_value_invalid" });
    expect(await countSetEvents(id)).toBe(0);

    // Positive: a matching object passes + lands.
    await setCustomField("property", id, "geo", { city: "Bonn" });
    await stack.eventDispatcher?.runOnce();
    expect(await rawCustomFields(id)).toMatchObject({ geo: { city: "Bonn" } });
  });
});

describe("custom-fields integration — update-tenant-field (Bug-Bash D2)", () => {
  async function updateField(fieldKey: string, overrides: Record<string, unknown>, user = admin) {
    return stack.http.writeOk(
      "custom-fields:write:update-tenant-field",
      {
        entityName: "property",
        fieldKey,
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
        ...overrides,
      },
      user,
    );
  }

  test("define → update ersetzt Spalten + serializedField-Inhalt (Projektion)", async () => {
    await defineField("property", "priority", "number");
    await updateField("priority", {
      serializedField: { type: "number", min: 0, max: 10 },
      required: true,
      searchable: true,
      displayOrder: 7,
      label: { de: "Priorität", en: "Priority" },
    });

    const row = await fetchDefinitionRow(admin.tenantId, "priority");
    expect(row).toBeDefined();
    expect(row?.["type"]).toBe("number");
    expect(row?.["required"]).toBe(true);
    expect(row?.["searchable"]).toBe(true);
    expect(Number(row?.["display_order"])).toBe(7);
    // serializedField über den update-Pfad (flattenCompoundTypes ≠ create-Pfad)
    // zurückparsen — Inhalt beweisen, nicht nur write-success.
    const sf = JSON.parse(String(row?.["serialized_field"])) as Record<string, unknown>;
    expect(sf["min"]).toBe(0);
    expect(sf["max"]).toBe(10);
    expect(sf["label"]).toEqual({ de: "Priorität", en: "Priority" });
  });

  test("update ohne label entfernt ein bestehendes Label (Vollersatz-Semantik)", async () => {
    await defineField("property", "weight", "number");
    await updateField("weight", {
      serializedField: { type: "number" },
      label: { de: "Gewicht", en: "Weight" },
    });

    await updateField("weight", { serializedField: { type: "number" } });

    const row = await fetchDefinitionRow(admin.tenantId, "weight");
    const sf = JSON.parse(String(row?.["serialized_field"])) as Record<string, unknown>;
    expect(sf["label"]).toBeUndefined();
  });

  test("zwei sequentielle Updates ohne version_conflict (skipOptimisticLock)", async () => {
    await defineField("property", "stage", "text");
    await updateField("stage", { displayOrder: 1 });
    await updateField("stage", { displayOrder: 2 });
    const row = await fetchDefinitionRow(admin.tenantId, "stage");
    expect(Number(row?.["display_order"])).toBe(2);
  });

  test("update auf nicht-existente Definition → 404", async () => {
    const err = await stack.http.writeErr(
      "custom-fields:write:update-tenant-field",
      {
        entityName: "property",
        fieldKey: "ghost",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("type-Wechsel → 422 field_type_immutable, Bestand unverändert", async () => {
    await defineField("property", "color", "text");
    const err = await stack.http.writeErr(
      "custom-fields:write:update-tenant-field",
      {
        entityName: "property",
        fieldKey: "color",
        serializedField: { type: "number" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      admin,
    );
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({
      reason: "field_type_immutable",
      currentType: "text",
      requestedType: "number",
    });
    const row = await fetchDefinitionRow(admin.tenantId, "color");
    expect(row?.["type"]).toBe("text");
  });

  test("Cross-Tenant: fremde (entityName,fieldKey) → 404, Owner-Definition unverändert", async () => {
    await defineField("property", "secret", "text");
    // Expliziter Fremd-Tenant — createTestUser ohne tenantId landet im
    // selben Default-Test-Tenant wie `admin`.
    const otherAdmin = createTestUser({
      roles: ["TenantAdmin"],
      tenantId: "00000000-0000-4000-8000-000000000099",
    });
    const err = await stack.http.writeErr(
      "custom-fields:write:update-tenant-field",
      {
        entityName: "property",
        fieldKey: "secret",
        serializedField: { type: "text" },
        required: true,
        searchable: false,
        displayOrder: 0,
      },
      otherAdmin,
    );
    // aggregate-id deriviert aus otherAdmin.tenantId → trifft nichts.
    expect(err.httpStatus).toBe(404);
    const row = await fetchDefinitionRow(admin.tenantId, "secret");
    expect(row?.["required"]).toBe(false);
  });

  test("update-tenant-field rejects a caller whose tenant IS the system tenant", async () => {
    const systemScopedAdmin = createTestUser({
      roles: ["TenantAdmin"],
      tenantId: SYSTEM_TENANT_ID,
    });
    const err = await stack.http.writeErr(
      "custom-fields:write:update-tenant-field",
      {
        entityName: "property",
        fieldKey: "leaky",
        serializedField: { type: "text" },
        required: false,
        searchable: false,
        displayOrder: 0,
      },
      systemScopedAdmin,
    );
    // Guard wirft plain Error → 500; Message pinnen (wie der define-Guard-Test).
    expect(err.httpStatus).toBe(500);
    const causeMessage = (err.details as { causeMessage?: string } | undefined)?.causeMessage ?? "";
    expect(causeMessage).toContain("update-tenant-field");
  });
});

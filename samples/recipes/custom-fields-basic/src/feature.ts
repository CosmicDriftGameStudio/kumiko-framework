// kumiko-feature-version: 1
// Custom-Fields Basic Sample
//
// Shows how a feature opts a tenant-owned entity into the custom-fields
// extension: tenants can define their own fields at runtime, set values
// per row, and read them back flattened onto the entity — without writing
// a single migration or extra handler.
//
// Flow:
//   1. App-author defines a `property` entity and wires it via
//      `wireCustomFieldsFor(r, "property", propertyTable)`.
//   2. A tenant admin defines a field at runtime
//      (e.g. `internalNumber: text`) via the bundle's CRUD.
//   3. Values are written via `custom-fields:write:set-custom-field`,
//      not through the host entity's own write handler.
//   4. Reads return the field flattened onto the row — looks like a
//      first-class column. The flattening is an entity-level postQuery
//      hook (registered by wireCustomFieldsFor), so it fires for ANY
//      query whose name maps to this entity — including the hand-written
//      `property:list` below.

import {
  customFieldsField,
  wireCustomFieldsFor,
} from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// --- Entity ---
//
// The field shape is declared as a plain object literal so the feature is
// self-describing Object-Form (what the AI/Designer should emit). The same
// literal is passed inline to `r.entity` below. `{ type: "jsonb" }` is
// exactly what `customFieldsField()` produces — the jsonb column the
// bundle's projection writes into; without it `wireCustomFieldsFor` has
// nowhere to land the values.

export const propertyEntity = createEntity({
  table: "read_sample_cf_properties",
  fields: {
    name: { type: "text", required: true, maxLength: 200 },
    customFields: customFieldsField(),
  },
});

export const propertyTable = buildEntityTable("property", propertyEntity);

function propertyExecutor() {
  return createEventStoreExecutor(propertyTable, propertyEntity, { entityName: "property" });
}

// --- Feature ---

export const propertyFeature = defineFeature("property-management", (r) => {
  r.requires("custom-fields");

  r.entity("property", {
    table: "read_sample_cf_properties",
    fields: {
      name: { type: "text", required: true, maxLength: 200 },
      customFields: { type: "jsonb" },
    },
  });

  // Opt this entity into the custom-fields extension. This registers the
  // multi-stream projection (MSP) that consumes customField.set / .cleared
  // events and writes them into the `customFields` jsonb column, plus the
  // entity postQuery hook that flattens the jsonb onto the row at read-time.
  wireCustomFieldsFor(r, "property", propertyTable);

  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      propertyExecutor().create(
        { id: event.payload.id, name: event.payload.name, customFields: {} },
        event.user,
        ctx.db,
      ),
  });

  // List query. Named `property:list` so it maps to the `property` entity
  // (colon convention) — that mapping is what lets the entity postQuery
  // hook from wireCustomFieldsFor flatten customFields onto each row. The
  // handler itself just reads the tenant-scoped read table; ctx.db is
  // already tenant-scoped.
  r.queryHandler({
    name: "property:list",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_query, ctx) => {
      const rows = await ctx.db.selectMany(propertyTable);
      return { rows };
    },
  });
});

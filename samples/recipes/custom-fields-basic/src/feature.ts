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
//   3. Any property write can carry a `customFields` payload.
//   4. Reads return the field flattened onto the row — looks like a
//      first-class column.

import {
  customFieldsField,
  wireCustomFieldsFor,
} from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// --- Entity ---
//
// `customFieldsField()` adds the jsonb column the bundle's projection
// writes into. Without it, `wireCustomFieldsFor` has nowhere to land
// the values.

export const propertyEntity = createEntity({
  table: "read_sample_cf_properties",
  fields: {
    name: createTextField({ required: true, maxLength: 200 }),
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

  r.entity("property", propertyEntity);

  // Opt this entity into the custom-fields extension. This registers the
  // multi-stream projection (MSP) that consumes customField.set / .cleared
  // events and writes them into the `customFields` jsonb column, plus the
  // entity-hook that flattens the jsonb onto the row at query-time.
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

  r.queryHandler(
    defineEntityListHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

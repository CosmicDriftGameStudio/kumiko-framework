import { defineUnmanagedTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

export const noteEntity = createEntity({
  table: "read_sample_notes",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    content: createTextField({ personal: false, reason: "is_business_data" }),
  },
});

// Not event-sourced: ctx.db.upsert rejects executor-managed tables.
export const preferenceTable = defineUnmanagedTable({
  tableName: "sample_tenant_preferences",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "key", pgType: "text", notNull: true },
    { name: "value", pgType: "text", notNull: true },
  ],
  indexes: [
    { name: "sample_tenant_preferences_tenant_key", columns: ["tenant_id", "key"], unique: true },
  ],
});

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = {
  access: {
    openToAll: {
      reason:
        "any signed-in user may list and view notes in their own tenant (tenant " +
        "isolation, not per-user); writes are still gated by adminWrite",
    },
  },
} as const;

export const noteFeature = defineFeature("notes", (r) => {
  r.crud("note", noteEntity, {
    write: adminWrite,
    read: openRead,
    verbs: { update: false, delete: false, restore: false },
  });

  r.storeTable(preferenceTable, { reason: "settings.tenant_preferences" });

  r.writeHandler({
    name: "preference:set",
    schema: z.object({ key: z.string().min(1), value: z.string() }),
    handler: async (event, ctx) => {
      const row = await ctx.db.upsert<{ value: string }>(preferenceTable, event.payload, {
        conflictTarget: ["tenantId", "key"],
      });
      return { isSuccess: true, data: { value: row?.value } };
    },
    ...adminWrite,
  });
});

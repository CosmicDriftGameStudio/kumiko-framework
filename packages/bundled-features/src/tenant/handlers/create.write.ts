import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

// Optional `id`: SystemAdmin-only handler — legitimate path for seeds and
// external provisioning (SCIM, IdP sync, migration from existing systems),
// where the tenant must be created with a caller-chosen UUID. When unset,
// Postgres assigns a new UUID via gen_random_uuid().
export const createWrite = defineWriteHandler({
  name: "create",
  schema: z.object({
    id: z.uuid().optional(),
    key: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
  }),
  // "system" + "SystemAdmin" — symmetric to update-member-roles. Ops
  // tooling (seed migrations + sample recipes) uses the system user
  // (roles=["system"]) as the executor; "SystemAdmin" stays the real
  // human-operator path via the UI.
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:create requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("creating a tenant is inherently cross-tenant");
    return crud.create(event.payload, event.user, db);
  },
});

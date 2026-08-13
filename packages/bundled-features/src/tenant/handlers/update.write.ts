import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  InternalError,
  NotFoundError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantEntity, tenantTable } from "../schema/tenant";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

export const updateWrite = defineWriteHandler({
  name: "update",
  schema: z.object({
    id: z.uuid(),
    // Clients must send the version they read. The CrudExecutor rejects
    // missing versions with version_conflict — see the optimistic-locking
    // design note in crud-executor.ts.
    version: z.number(),
    changes: z.object({ name: z.string().min(1).max(200).optional() }),
  }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:update requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }

    // "Admin" is tenant-scoped and must not touch another tenant's row —
    // SystemAdmin is the platform-wide role and stays cross-tenant by design.
    if (event.user.roles.includes("SystemAdmin")) {
      const db = ctx.systemDb.acknowledgeCrossTenant("SystemAdmin is platform-wide by design");
      return crud.update(event.payload, event.user, db);
    }

    let db: TenantDb;
    try {
      db = ctx.systemDb.assertTenantMatch(event.payload.id);
    } catch (err) {
      // Kept as tenant_not_found (not the underlying access_denied) so a
      // cross-tenant Admin can't use the error to enumerate tenant existence.
      if (err instanceof AccessDeniedError) {
        return writeFailure(new NotFoundError("tenant", event.payload.id));
      }
      throw err;
    }
    return crud.update(event.payload, event.user, db);
  },
});

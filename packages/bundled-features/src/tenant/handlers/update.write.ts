import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  NotFoundError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireSystemDb } from "../../shared/index.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";

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
  description:
    "Renames a tenant against the version the caller read; an Admin may only rename their own tenant, a SystemAdmin any of them.",
  handler: async (event, ctx) => {
    const systemDb = requireSystemDb(ctx, "tenant:write:update");

    // "Admin" is tenant-scoped and must not touch another tenant's row —
    // SystemAdmin is the platform-wide role and stays cross-tenant by design.
    if (event.user.roles.includes("SystemAdmin")) {
      const db = systemDb.acknowledgeCrossTenant("SystemAdmin is platform-wide by design");
      return crud.update(event.payload, event.user, db);
    }

    let db: TenantDb;
    try {
      db = systemDb.assertTenantMatch(event.payload.id);
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

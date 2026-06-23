import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type DbRow } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, withResponseData } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { findForbiddenMembershipRole, reservedMembershipRoleError } from "../membership-roles";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

export const updateMemberRolesWrite = defineWriteHandler({
  name: "updateMemberRoles",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()).min(1),
  }),
  // "system" + "SystemAdmin" — symmetrisch zu tenant:write:create. System-
  // User (createSystemUser, roles=["system"]) braucht den Access für seed-
  // migrations + andere ops-tooling-Pfade. SystemAdmin ist der echte
  // human-Operator-Pfad über die UI.
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const forbidden = findForbiddenMembershipRole(event.payload.roles);
    if (forbidden !== undefined) return writeFailure(reservedMembershipRoleError(forbidden));
    const existing = await fetchOne(db, tenantMembershipsTable, {
      userId: event.payload.userId,
      tenantId: event.payload.tenantId,
    });
    if (!existing) {
      return writeFailure(
        new NotFoundError("membership", undefined, {
          i18nKey: "tenant.errors.membershipNotFound",
          i18nParams: { userId: event.payload.userId, tenantId: event.payload.tenantId },
        }),
      );
    }

    // fetchOne already gave us the stream version — hand it to the executor
    // instead of skipping the lock. Race window (another SystemAdmin writing
    // between this read and append) surfaces as version_conflict rather than
    // silent overwrite. Per-membership parallelism is rare; if it happens,
    // the client retries on the error.
    const row = existing as DbRow; // @cast-boundary generic-record
    const result = await executor.update(
      {
        id: row["id"] as string, // @cast-boundary db-row
        version: row["version"] as number, // @cast-boundary db-row
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      event.user,
      db,
    );
    return withResponseData(result, event.payload);
  },
});

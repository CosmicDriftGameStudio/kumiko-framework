// EXT_USER_DATA hooks for the folder + folder-assignment entities (GDPR Art. 20
// export / Art. 17 erasure). Lives apart from the folders feature so folders
// consumers without the user-data-rights pipeline don't pull a hard dependency.
// Mirrors credit-user-data — standard tenant-scoped pattern, no name-stripping
// (a folder name is tenant data, not per-user PII).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb, type EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { folderAssignmentEntity, folderEntity } from "../folders";

const { table: folderTable, executor: folderExecutor } = createEntityExecutor(
  "folder",
  folderEntity,
);
const { table: folderAssignmentTable, executor: folderAssignmentExecutor } = createEntityExecutor(
  "folder-assignment",
  folderAssignmentEntity,
);

// Folders are tenant-scoped (no per-user owner column). Every tenant user reads
// all tenant folders in-app, so bundling them into the user's export is no new
// exposure — it gives the data subject the organisation of the loans they work with.
export const folderExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<Record<string, unknown>>(ctx.db, folderTable, {
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return null;
  return { entity: "folder", rows };
};

export const folderAssignmentExportHook: UserDataExportHook = async (ctx) => {
  // folderAssignmentEntity is softDelete: true — a cleared assignment
  // (isDeleted: true) is a removed folder membership, not something the GDPR
  // export should still surface as current data.
  const rows = await selectMany<Record<string, unknown>>(ctx.db, folderAssignmentTable, {
    tenantId: ctx.tenantId,
    isDeleted: false,
  });
  if (rows.length === 0) return null;
  return { entity: "folder-assignment", rows };
};

// Tenant-scoped erasure is only safe when the tenant is effectively single-user
// (set by the forget orchestrator from the app's tenantModel + a runtime
// sole-member check). In a multi-user tenant this stays a no-op: deleting by
// tenant would destroy co-members' folders. anonymize is also a no-op — folder
// rows carry no person-link to strip (name is tenant data, not PII), so a
// retention hold simply keeps them.
function tenantScopedDelete(
  table: typeof folderTable,
  executor: EventStoreExecutor,
): UserDataDeleteHook {
  return async (ctx, strategy) => {
    // skip: multi-user tenant — a tenant-wide delete would destroy co-members' folders
    if (ctx.tenantModel !== "single-user") return;
    // skip: anonymize is a no-op — folder rows carry no per-user PII to strip
    if (strategy === "anonymize") return;
    // Per-row via the executor (event -> rebuild-safe): a bulk deleteMany is
    // eventless, so a projection rebuild resurrects the rows. Bounded — forget
    // only fires for single-user tenants.
    const systemUser = createSystemUser(ctx.tenantId);
    // The executor needs a TenantDb (loadById → db.fetchOne), not the raw ctx.db.
    const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");
    const rows = await selectMany<{ id: string }>(ctx.db, table, { tenantId: ctx.tenantId });
    for (const row of rows) {
      await executor.delete({ id: row.id }, systemUser, tdb);
    }
  };
}

export const folderDeleteHook: UserDataDeleteHook = tenantScopedDelete(folderTable, folderExecutor);
export const folderAssignmentDeleteHook: UserDataDeleteHook = tenantScopedDelete(
  folderAssignmentTable,
  folderAssignmentExecutor,
);

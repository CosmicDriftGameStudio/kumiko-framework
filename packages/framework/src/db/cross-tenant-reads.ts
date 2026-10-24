import type { EscapeHatchReporter } from "@cosmicdrift/kumiko-types/handlers";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";

import { type CreateTenantDbOptions, createTenantDb, type TenantDb } from "./tenant-db.ts";

export function createCrossTenantReads(
  systemModeDb: TenantDb,
  reason: string,
  report: EscapeHatchReporter,
): CrossTenantReads {
  return {
    selectMany(table, where, options) {
      report("cross-tenant-read", reason);
      return systemModeDb.selectMany(table, where, options);
    },
    fetchOne(table, where) {
      report("cross-tenant-read", reason);
      return systemModeDb.fetchOne(table, where);
    },
    count(table, where) {
      report("cross-tenant-read", reason);
      return systemModeDb.count(table, where);
    },
  };
}

// Own system-mode TenantDb without unsafeRaw/globalWrites: the handler gets the read surface only.
export function createHandlerCrossTenantReads(
  options: Omit<CreateTenantDbOptions, "mode"> & {
    readonly reason: string;
    readonly report: EscapeHatchReporter;
  },
): CrossTenantReads {
  const { reason, report, ...dbOptions } = options;
  const systemModeDb = createTenantDb({ ...dbOptions, mode: "system", reason });
  return createCrossTenantReads(systemModeDb, reason, report);
}

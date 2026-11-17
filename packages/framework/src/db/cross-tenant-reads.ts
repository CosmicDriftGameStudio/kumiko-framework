import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { EscapeHatchReporter } from "@cosmicdrift/kumiko-types/handlers";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { SelectOptions, WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";

import { type CreateTenantDbOptions, createTenantDb, type TenantDb } from "./tenant-db.ts";

export function createCrossTenantReads(
  systemModeDb: TenantDb,
  reason: string,
  report: EscapeHatchReporter,
): CrossTenantReads {
  return {
    selectMany<T = Record<string, unknown>>(
      table: SchemaTable | EntityTableMeta,
      where?: WhereObject,
      options?: SelectOptions,
    ): Promise<readonly T[]> {
      report("cross-tenant-read", reason);
      return systemModeDb.selectMany<T>(table, where, options);
    },
    fetchOne<T = Record<string, unknown>>(
      table: SchemaTable | EntityTableMeta,
      where: WhereObject,
    ): Promise<T | undefined> {
      report("cross-tenant-read", reason);
      return systemModeDb.fetchOne<T>(table, where);
    },
    count(table, where) {
      report("cross-tenant-read", reason);
      return systemModeDb.count(table, where);
    },
    aggregate(table, spec, where) {
      report("cross-tenant-read", reason);
      return systemModeDb.aggregate(table, spec, where);
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

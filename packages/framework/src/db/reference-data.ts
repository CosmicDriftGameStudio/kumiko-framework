import { fetchOne } from "../db/query.ts";
import type { Registry } from "../engine/index.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { EntityId, ReferenceDataDef } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { reraiseAsKumikoError } from "../errors/index.ts";
import type { DbConnection } from "./connection.ts";
import { entityTableFromRegistry } from "./entity-table-from-registry.ts";
import { createEventStoreExecutor } from "./event-store-executor.ts";
import { createTenantDb } from "./tenant-db.ts";

type ExistingRow = Record<string, unknown> & { id: EntityId; version: number };

/**
 * Seed reference data at boot time.
 * For each ReferenceDataDef: upsert rows (insert missing, update changed, never delete).
 * Upsert key defaults to the first field in the data object.
 *
 * Rows go through the entity's event-store executor as the system user in the
 * SYSTEM_TENANT_ID stream, so the seed is replayable on a projection rebuild.
 */
export async function seedReferenceData(
  defs: readonly ReferenceDataDef[],
  registry: Registry,
  db: DbConnection,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const by = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb({ db, tenantId: SYSTEM_TENANT_ID, mode: "system" });

  for (const def of defs) {
    const entity = registry.getEntity(def.entityName);
    if (!entity) continue;
    if (def.data.length === 0) continue;

    const firstRow = def.data[0];
    if (!firstRow) continue;
    const firstKey = Object.keys(firstRow)[0];
    if (!firstKey) continue;
    const upsertKey = def.upsertKey ?? firstKey;

    const table = entityTableFromRegistry(registry, def.entityName, entity);
    const executor = createEventStoreExecutor(table, entity, { entityName: def.entityName });

    for (const row of def.data) {
      const keyValue = row[upsertKey];
      if (keyValue === undefined) continue;

      // Soft-deleted rows are invisible to executor.update, so treat them as missing and re-create.
      const existing = await fetchOne<ExistingRow>(db, table, {
        [upsertKey]: keyValue,
        tenantId: SYSTEM_TENANT_ID,
        ...(entity.softDelete && { isDeleted: false }),
      });

      if (existing) {
        const changes: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(row)) {
          if (field === upsertKey) continue;
          if (existing[field] !== value) {
            changes[field] = value;
          }
        }
        if (Object.keys(changes).length > 0) {
          const result = await executor.update(
            { id: existing.id, version: existing.version, changes },
            by,
            tdb,
          );
          if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
          updated++;
        }
      } else {
        const result = await executor.create({ ...row, tenantId: SYSTEM_TENANT_ID }, by, tdb);
        if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
        inserted++;
      }
    }
  }

  return { inserted, updated };
}

import { v5 as uuidv5 } from "uuid";
import type { EntityDefinition } from "../engine";
import { createSystemUser, SYSTEM_TENANT_ID } from "../engine";
import type { ConfigSeedDef, Registry } from "../engine/types";
import type { DbConnection } from "./connection";
import type { EncryptionProvider } from "./encryption";
import { createEventStoreExecutor } from "./event-store-executor";
import type { DrizzleTable } from "./table-builder";
import { createTenantDb } from "./tenant-db";

// Namespace UUID for deterministic seed aggregate IDs. Same namespace +
// (key, tenantId, userId) triple always produces the same UUIDv5, which
// makes executor.create(…, expectedVersion: 0) hit version_conflict on
// re-boot — no new stream created, idempotent without DB-level checks.
const CONFIG_SEED_NS = "6f1e9d8c-2a5b-4c7d-9e3f-1a2b3c4d5e6f";

/**
 * Seed config values at boot time via the event-store executor.
 *
 * For each ConfigSeedDef: calls executor.create(payload, SYSTEM_USER, db).
 * When the aggregate stream already exists (e.g. re-boot, admin-override),
 * the executor returns a WriteFailure(version_conflict) which we skip.
 *
 * Idempotent, race-safe via DB-level unique constraints, and visible to
 * multi-stream-projection subscribers as normal configValue.created events.
 */
export async function seedConfigValues(
  seeds: readonly ConfigSeedDef[],
  table: DrizzleTable,
  entity: EntityDefinition,
  registry: Registry,
  db: DbConnection,
  encryption?: EncryptionProvider,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  if (seeds.length === 0) return { created, skipped };

  const systemUser = createSystemUser(SYSTEM_TENANT_ID);
  const executor = createEventStoreExecutor(table, entity, { entityName: "config-value" });
  const tdb = createTenantDb(db, SYSTEM_TENANT_ID, "system");

  for (const seed of seeds) {
    const keyDef = registry.getConfigKey(seed.key);
    if (!keyDef) {
      skipped++;
      continue;
    }

    // Encrypted keys without an encryption provider would silently write
    // plaintext to a column the resolver later tries to decrypt — fail
    // loud at boot, not on first read in prod.
    if (keyDef.encrypted && !encryption) {
      throw new Error(
        `seedConfigValues: key "${seed.key}" is encrypted but no EncryptionProvider was supplied.`,
      );
    }

    const scope = seed.scope ?? keyDef.scope;

    // User-scope seeds need a concrete tenantId because the resolver
    // user-cascade matches the user's actual tenantId, not the SYSTEM
    // sentinel — a SYSTEM-rooted user row would be unreachable.
    if (scope === "user" && (!seed.tenantId || !seed.userId)) {
      throw new Error(
        `seedConfigValues: user-scope seed "${seed.key}" requires both tenantId and userId — use createUserSeed({value}, {tenantId, userId}).`,
      );
    }

    const tenantId = seed.tenantId ?? SYSTEM_TENANT_ID;
    const userId = scope === "user" ? (seed.userId ?? null) : null;

    // Deterministic aggregate id (key+tenant+user triple) so re-boot hits
    // the existing stream → version_conflict → counted as skipped.
    const idSource = `${seed.key}:${tenantId}:${userId ?? ""}`;
    const aggregateId = uuidv5(idSource, CONFIG_SEED_NS);

    let value = JSON.stringify(seed.value);
    if (keyDef.encrypted && encryption) {
      value = encryption.encrypt(value);
    }

    const payload: Record<string, unknown> = {
      id: aggregateId,
      key: seed.key,
      value,
      tenantId,
      userId,
    };

    const result = await executor.create(payload, systemUser, tdb);

    if (result.isSuccess) {
      created++;
    } else {
      // version_conflict (stream exists) and unique_violation (projection
      // race) both mean "already seeded" — count as skipped, not error.
      skipped++;
    }
  }

  return { created, skipped };
}

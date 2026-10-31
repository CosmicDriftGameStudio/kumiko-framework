// blockDelete rows of a tenant under destruction: the mandatory retention period outlives the account.
// The tenant-lifecycle destroy pipeline keeps those rows (anonymized) and parks the tenant until the
// retention cleanup has removed them.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  selectMany,
  type WhereObject,
  WritePurposes,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityDefinition,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { collectFileRefIds, planFileFields } from "../shared/index.ts";
import { computeCutoff, type Instant } from "./keep-for.ts";
import { resolveRetentionPolicyForTenant } from "./resolve-for-tenant.ts";
import { resolveTenantRetentionPreset } from "./resolve-tenant-preset.ts";
import {
  anonymizeMatchingRows,
  DEFAULT_REFERENCE_FIELD,
  FRAMEWORK_REFERENCE_ALIAS,
  loadOverrideByEntity,
  resolveAnonymizeTargets,
} from "./run-retention-cleanup.ts";

const ANONYMIZE_PAGE_SIZE = 1000;

type ProjectionTable = Parameters<typeof selectMany>[1];

type BlockDeleteEntity = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly table: ProjectionTable;
  readonly referenceField: string;
  readonly cutoff: Instant;
};

type TenantHoldArgs = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly now: Instant;
};

async function collectBlockDeleteEntities(args: TenantHoldArgs): Promise<BlockDeleteEntity[]> {
  const { db, registry, tenantId, now } = args;
  const preloadedTenantPreset = await resolveTenantRetentionPreset({ db, registry, tenantId });
  const overrideByEntity = await loadOverrideByEntity(db, tenantId);
  const found: BlockDeleteEntity[] = [];
  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entityName = proj.source;
    const entity = registry.getEntity(entityName);
    if (!entity) continue;
    const { policy } = await resolveRetentionPolicyForTenant({
      db,
      registry,
      tenantId,
      entityName,
      preloadedTenantPreset,
      preloadedOverride: overrideByEntity.get(entityName) ?? null,
    });
    if (policy?.strategy !== "blockDelete") continue;
    // Rows of an entity without tenantId column cannot be attributed to this tenant.
    if (propertyOf(proj.table, "tenantId") === undefined) continue;
    const declaredReference = policy.reference ?? DEFAULT_REFERENCE_FIELD;
    const referenceField = FRAMEWORK_REFERENCE_ALIAS[declaredReference] ?? declaredReference;
    if (propertyOf(proj.table, referenceField) === undefined) continue;
    found.push({
      entityName,
      entity,
      table: proj.table,
      referenceField,
      cutoff: computeCutoff(policy.keepFor, now),
    });
  }
  return found;
}

async function hasAnyRow(
  db: DbRunner,
  table: ProjectionTable,
  where: WhereObject,
): Promise<boolean> {
  return (await selectMany(db, table, where, { limit: 1 })).length > 0;
}

/** True while the tenant still owns rows in an entity whose resolved policy is blockDelete. */
export async function tenantHasBlockDeleteRows(args: TenantHoldArgs): Promise<boolean> {
  for (const held of await collectBlockDeleteEntities(args)) {
    if (await hasAnyRow(args.db, held.table, { tenantId: args.tenantId })) return true;
  }
  return false;
}

export type DestructionHold = {
  readonly entityNames: ReadonlySet<string>;
  /** fileRefs the held rows point at: their rows and bytes must outlive the destruction too. */
  readonly fileRefIds: ReadonlySet<string>;
};

async function collectHeldRowFileRefIds(
  args: TenantHoldArgs,
  held: BlockDeleteEntity,
  into: Set<string>,
): Promise<void> {
  const plan = planFileFields(held.entity.fields);
  if (plan.singleFields.length === 0 && plan.multiFields.length === 0) return;
  let cursor: string | undefined;
  for (;;) {
    const where: WhereObject =
      cursor === undefined
        ? { tenantId: args.tenantId }
        : { tenantId: args.tenantId, id: { gt: cursor } };
    const rows = await selectMany<Record<string, unknown>>(args.db, held.table, where, {
      limit: ANONYMIZE_PAGE_SIZE,
      orderBy: { col: "id" },
    });
    if (rows.length === 0) return;
    for (const row of rows) {
      for (const id of await collectFileRefIds(
        args.db,
        args.tenantId,
        held.entityName,
        row,
        plan,
      )) {
        into.add(id);
      }
    }
    cursor = String(rows[rows.length - 1]?.["id"]);
  }
}

/**
 * Entities of the tenant with at least one blockDelete row still inside keepFor. All tenant rows of
 * those entities get their personal fields anonymized (idempotent: already anonymized rows emit no
 * event) and stay; the caller must not delete them, nor the fileRefs they point at.
 */
export async function holdBlockDeleteRowsForDestruction(
  args: TenantHoldArgs,
): Promise<DestructionHold> {
  const heldEntityNames = new Set<string>();
  const heldFileRefIds = new Set<string>();
  const systemUser = createSystemUser(args.tenantId);
  const tdb = createTenantDb({
    db: args.db,
    tenantId: args.tenantId,
    mode: "system",
    reason: "tenant destruction anonymizes retention-held rows of the tenant being destroyed",
  });
  for (const candidate of await collectBlockDeleteEntities(args)) {
    const { entityName, entity, table } = candidate;
    const stillInsideKeepFor = await hasAnyRow(args.db, table, {
      tenantId: args.tenantId,
      [candidate.referenceField]: { gte: candidate.cutoff },
    });
    if (!stillInsideKeepFor) continue;
    heldEntityNames.add(entityName);
    await collectHeldRowFileRefIds(args, candidate, heldFileRefIds);
    const targets = await resolveAnonymizeTargets(entity.fields);
    if (!targets) continue;
    const executor = createEventStoreExecutor(table, entity, { entityName });
    let updated = ANONYMIZE_PAGE_SIZE;
    while (updated === ANONYMIZE_PAGE_SIZE) {
      updated = await anonymizeMatchingRows(
        args.db,
        table,
        { tenantId: args.tenantId },
        ANONYMIZE_PAGE_SIZE,
        targets,
        async (id, changes) => {
          const result = await executor.update({ id, changes }, systemUser, tdb, {
            skipOptimisticLock: true,
            writePurpose: WritePurposes.retention,
          });
          if (!result.isSuccess) {
            throw new Error(
              `data-retention: failed to anonymize held ${entityName} row ${String(id)}: ${result.error.message}`,
            );
          }
          return result;
        },
      );
    }
  }
  return { entityNames: heldEntityNames, fileRefIds: heldFileRefIds };
}

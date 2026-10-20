import {
  COMPLIANCE_PROFILES,
  subtractRetentionSpec,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  aggregateWhere,
  runnerCanBeginTransaction,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigResolver,
  parseTenantId,
  type Registry,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { pruneEvents } from "@cosmicdrift/kumiko-framework/pipeline";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resolveProfileForTenant } from "../compliance-profiles/index.ts";
import { createConfigAccessor } from "../config/index.ts";
import {
  ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  escapeHatchUsedSchema,
} from "./escape-hatch-audit-sink.ts";
import {
  DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
  ESCAPE_HATCH_RETENTION_DAYS_KEY,
} from "./web/constants.ts";

// pruneEvents opens its own transaction, so a runner that cannot begin one (a tx handle) is rejected instead of nested.
export function isDbConnection(runner: DbRunner): runner is DbConnection {
  return runnerCanBeginTransaction(runner);
}

async function resolveRetentionDays(args: {
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly db: DbConnection;
  readonly userId: string;
}): Promise<number> {
  if (!args.configResolver) return DEFAULT_ESCAPE_HATCH_RETENTION_DAYS;
  const config = createConfigAccessor(
    args.registry,
    args.configResolver,
    SYSTEM_TENANT_ID,
    args.userId,
    args.db,
  );
  const raw = await config(ESCAPE_HATCH_RETENTION_DAYS_KEY);
  return typeof raw === "number" && raw >= 1 ? raw : DEFAULT_ESCAPE_HATCH_RETENTION_DAYS;
}

// Only an operator-set value counts: the key's declared default must not override the tenant profiles.
async function resolveExplicitRetentionDays(args: {
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly db: DbConnection;
  readonly userId: string;
}): Promise<number | undefined> {
  const keyDef = args.registry.getConfigKey(ESCAPE_HATCH_RETENTION_DAYS_KEY);
  if (!args.configResolver || !keyDef) return undefined;
  const { value, source } = await args.configResolver.getWithSource(
    ESCAPE_HATCH_RETENTION_DAYS_KEY,
    keyDef,
    SYSTEM_TENANT_ID,
    args.userId,
    args.db,
  );
  const isOperatorSet = source !== "default" && source !== "missing";
  return isOperatorSet && typeof value === "number" && value >= 1 ? value : undefined;
}

// Soft dependency: audit must stay mountable without compliance-profiles, so we probe its entity.
const COMPLIANCE_PROFILE_ENTITY = "tenant-compliance-profile";
const PRUNE_CHUNK_SIZE = 1000;
const PRUNE_BATCH_SIZE = 5000;
const SCAN_PAGE_SIZE = 2000;

type AuditEventRow = {
  readonly id: bigint;
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  readonly createdAt: Temporal.Instant;
  readonly payload: unknown;
};

// Overrides may only lengthen retention: the earlier cutoff (same `now`) is the longer period.
function earlierInstant(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) <= 0 ? a : b;
}

async function resolveTenantCutoff(
  db: DbConnection,
  tenantId: TenantId,
  now: Temporal.Instant,
  operatorFloor: Temporal.Instant | undefined,
): Promise<Temporal.Instant> {
  const { profile } = await resolveProfileForTenant({ db, tenantId });
  const effective = subtractRetentionSpec(now, profile.auditLog.retention);
  const base = subtractRetentionSpec(now, COMPLIANCE_PROFILES[profile.key].auditLog.retention);
  const profileCutoff = earlierInstant(effective, base);
  return operatorFloor ? earlierInstant(profileCutoff, operatorFloor) : profileCutoff;
}

// A cross-tenant audit (e.g. identity-switch) lives under the actor's tenant but must also
// satisfy the target tenant's retention. A malformed payload falls back to the storing tenant.
function targetTenantOf(payload: unknown): TenantId | null {
  const parsed = escapeHatchUsedSchema.safeParse(payload);
  return parsed.success ? parseTenantId(parsed.data.targetTenantId) : null;
}

// No tenant's cutoff can be later than the shortest built-in retention: overrides only lengthen it.
function latestPossibleCutoff(now: Temporal.Instant): Temporal.Instant {
  const cutoffs = Object.values(COMPLIANCE_PROFILES).map((profile) =>
    subtractRetentionSpec(now, profile.auditLog.retention),
  );
  return cutoffs.reduce((latest, cutoff) =>
    Temporal.Instant.compare(cutoff, latest) > 0 ? cutoff : latest,
  );
}

async function storingTenantIds(
  db: DbConnection,
  expirableBefore: Temporal.Instant,
): Promise<readonly TenantId[]> {
  const groups = await aggregateWhere(
    db,
    eventsTable,
    { measure: { fn: "count" }, groupBy: [{ field: "tenantId" }] },
    { aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE, createdAt: { lt: expirableBefore } },
  );
  return groups.flatMap((group) => {
    const tenantId = parseTenantId(group.keys[0]);
    return tenantId ? [tenantId] : [];
  });
}

async function pruneAggregates(db: DbConnection, aggregateIds: readonly string[]): Promise<number> {
  const now = getTemporal().Now.instant();
  let deletedCount = 0;
  for (let i = 0; i < aggregateIds.length; i += PRUNE_CHUNK_SIZE) {
    const result = await pruneEvents(db, {
      aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
      aggregateIds: aggregateIds.slice(i, i + PRUNE_CHUNK_SIZE),
      olderThan: now,
    });
    deletedCount += result.deletedCount;
  }
  return deletedCount;
}

async function pruneByTenantProfiles(
  db: DbConnection,
  operatorRetentionDays: number | undefined,
  scanPageSize: number,
): Promise<number> {
  const now = getTemporal().Now.instant();
  const operatorFloor =
    operatorRetentionDays === undefined
      ? undefined
      : now.subtract({ hours: operatorRetentionDays * 24 });
  const cutoffByTenant = new Map<TenantId, Temporal.Instant>();
  const cutoffOf = async (tenantId: TenantId): Promise<Temporal.Instant> => {
    const cached = cutoffByTenant.get(tenantId);
    if (cached) return cached;
    const cutoff = await resolveTenantCutoff(db, tenantId, now, operatorFloor);
    cutoffByTenant.set(tenantId, cutoff);
    return cutoff;
  };

  // The effective cutoff is never later than the storing tenant's, so only rows older than
  // that one can expire; everything younger stays in the database.
  let deletedCount = 0;
  for (const storingTenantId of await storingTenantIds(db, latestPossibleCutoff(now))) {
    const storeCutoff = await cutoffOf(storingTenantId);
    // Keyset on id: pruning a page only removes rows at or below the cursor.
    let afterId: bigint | undefined;
    for (;;) {
      const page = await selectMany<AuditEventRow>(
        db,
        eventsTable,
        {
          aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
          tenantId: storingTenantId,
          createdAt: { lt: storeCutoff },
          ...(afterId !== undefined && { id: { gt: afterId } }),
        },
        {
          fields: ["id", "aggregateId", "createdAt", "payload"],
          orderBy: { col: "id", direction: "asc" },
          limit: scanPageSize,
        },
      );
      const expiredAggregateIds: string[] = [];
      for (const row of page) {
        const targetTenantId = targetTenantOf(row.payload);
        const cutoff = targetTenantId
          ? earlierInstant(storeCutoff, await cutoffOf(targetTenantId))
          : storeCutoff;
        if (Temporal.Instant.compare(row.createdAt, cutoff) < 0) {
          expiredAggregateIds.push(row.aggregateId);
        }
      }
      deletedCount += await pruneAggregates(db, expiredAggregateIds);
      const lastRow = page[page.length - 1];
      if (lastRow === undefined || page.length < scanPageSize) break;
      afterId = lastRow.id;
    }
  }
  return deletedCount;
}

async function pruneInBatches(
  db: DbConnection,
  olderThanDays: number,
  batchSize = PRUNE_BATCH_SIZE,
): Promise<number> {
  const olderThan = getTemporal()
    .Now.instant()
    .subtract({ hours: olderThanDays * 24 });
  let deletedCount = 0;
  for (;;) {
    const batch = await pruneEvents(db, {
      aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
      olderThan,
      batchSize,
    });
    deletedCount += batch.deletedCount;
    if (batch.deletedCount < batchSize) return deletedCount;
  }
}

export async function runEscapeHatchRetention(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly userId: string;
  readonly batchSize?: number;
  readonly scanPageSize?: number;
}): Promise<{ readonly deletedCount: number }> {
  const { db } = args;
  if (!isDbConnection(db)) {
    throw new Error("audit escape-hatch retention: a transaction-free DbConnection is required");
  }

  if (!args.registry.getEntity(COMPLIANCE_PROFILE_ENTITY)) {
    const olderThanDays = await resolveRetentionDays({ ...args, db });
    return { deletedCount: await pruneInBatches(db, olderThanDays, args.batchSize) };
  }

  const operatorRetentionDays = await resolveExplicitRetentionDays({ ...args, db });
  return {
    deletedCount: await pruneByTenantProfiles(
      db,
      operatorRetentionDays,
      args.scanPageSize ?? SCAN_PAGE_SIZE,
    ),
  };
}

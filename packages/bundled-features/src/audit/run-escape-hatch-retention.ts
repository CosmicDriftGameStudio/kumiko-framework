import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  COMPLIANCE_PROFILES,
  subtractRetentionSpec,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
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
import { resolveProfileForTenant } from "../compliance-profiles/index.js";
import { createConfigAccessor } from "../config/index.js";
import {
  DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
  ESCAPE_HATCH_RETENTION_DAYS_KEY,
} from "./constants.js";
import {
  ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  escapeHatchUsedSchema,
} from "./escape-hatch-audit-sink.js";

// pruneEvents opens its own transaction, so a runner that cannot begin one (a tx handle) is rejected instead of nested.
export function isDbConnection(runner: DbRunner): runner is DbConnection {
  return "begin" in runner && typeof runner.begin === "function";
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

// Soft dependency: audit must stay mountable without compliance-profiles, so we probe its entity.
const COMPLIANCE_PROFILE_ENTITY = "tenant-compliance-profile";
const PRUNE_CHUNK_SIZE = 1000;

type AuditEventRow = {
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
): Promise<Temporal.Instant> {
  const { profile } = await resolveProfileForTenant({ db, tenantId });
  const effective = subtractRetentionSpec(now, profile.auditLog.retention);
  const base = subtractRetentionSpec(now, COMPLIANCE_PROFILES[profile.key].auditLog.retention);
  return earlierInstant(effective, base);
}

// A cross-tenant audit (e.g. identity-switch) lives under the actor's tenant but must also
// satisfy the target tenant's retention. A malformed payload falls back to the storing tenant.
function targetTenantOf(payload: unknown): TenantId | null {
  const parsed = escapeHatchUsedSchema.safeParse(payload);
  return parsed.success ? parseTenantId(parsed.data.targetTenantId) : null;
}

async function pruneByTenantProfiles(db: DbConnection): Promise<number> {
  const rows = await selectMany<AuditEventRow>(db, eventsTable, {
    aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  });
  const now = getTemporal().Now.instant();
  const cutoffByTenant = new Map<TenantId, Temporal.Instant>();
  const cutoffOf = async (tenantId: TenantId): Promise<Temporal.Instant> => {
    const cached = cutoffByTenant.get(tenantId);
    if (cached) return cached;
    const cutoff = await resolveTenantCutoff(db, tenantId, now);
    cutoffByTenant.set(tenantId, cutoff);
    return cutoff;
  };

  const expiredAggregateIds: string[] = [];
  for (const row of rows) {
    const targetTenantId = targetTenantOf(row.payload);
    const storeCutoff = await cutoffOf(row.tenantId);
    const cutoff = targetTenantId
      ? earlierInstant(storeCutoff, await cutoffOf(targetTenantId))
      : storeCutoff;
    if (Temporal.Instant.compare(row.createdAt, cutoff) < 0) {
      expiredAggregateIds.push(row.aggregateId);
    }
  }

  let deletedCount = 0;
  for (let i = 0; i < expiredAggregateIds.length; i += PRUNE_CHUNK_SIZE) {
    const result = await pruneEvents(db, {
      aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
      aggregateIds: expiredAggregateIds.slice(i, i + PRUNE_CHUNK_SIZE),
      olderThan: now,
    });
    deletedCount += result.deletedCount;
  }
  return deletedCount;
}

export async function runEscapeHatchRetention(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly userId: string;
}): Promise<{ readonly deletedCount: number }> {
  const { db } = args;
  if (!isDbConnection(db)) {
    throw new Error("audit escape-hatch retention: a transaction-free DbConnection is required");
  }

  if (!args.registry.getEntity(COMPLIANCE_PROFILE_ENTITY)) {
    const olderThanDays = await resolveRetentionDays({ ...args, db });
    const { deletedCount } = await pruneEvents(db, {
      aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
      olderThanDays,
    });
    return { deletedCount };
  }

  return { deletedCount: await pruneByTenantProfiles(db) };
}

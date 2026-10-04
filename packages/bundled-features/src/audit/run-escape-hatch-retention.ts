import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { subtractRetentionSpec } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigResolver,
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
import { ESCAPE_HATCH_USE_AGGREGATE_TYPE } from "./escape-hatch-audit-sink.js";

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

async function distinctEscapeHatchTenants(db: DbConnection): Promise<readonly TenantId[]> {
  const rows = await selectMany<{ tenantId: TenantId }>(db, eventsTable, {
    aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  });
  return [...new Set(rows.map((row) => row.tenantId))];
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

  const now = getTemporal().Now.instant();
  let deletedCount = 0;
  for (const tenantId of await distinctEscapeHatchTenants(db)) {
    const { profile } = await resolveProfileForTenant({ db, tenantId });
    const result = await pruneEvents(db, {
      aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
      tenantIds: [tenantId],
      olderThan: subtractRetentionSpec(now, profile.auditLog.retention),
    });
    deletedCount += result.deletedCount;
  }
  return { deletedCount };
}

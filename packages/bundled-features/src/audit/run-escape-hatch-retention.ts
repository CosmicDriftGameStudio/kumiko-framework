import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigResolver,
  type Registry,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { type PruneEventsResult, pruneEvents } from "@cosmicdrift/kumiko-framework/pipeline";
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

export async function runEscapeHatchRetention(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly userId: string;
}): Promise<PruneEventsResult> {
  const { db } = args;
  if (!isDbConnection(db)) {
    throw new Error("audit escape-hatch retention: a transaction-free DbConnection is required");
  }
  const olderThanDays = await resolveRetentionDays({ ...args, db });
  return pruneEvents(db, {
    aggregateTypes: [ESCAPE_HATCH_USE_AGGREGATE_TYPE],
    olderThanDays,
  });
}

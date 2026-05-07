import { getTableName } from "drizzle-orm";
import { tableExists } from "../db/schema-inspection";
import type { Registry } from "../engine/types";
import { unsafePushTables } from "./table-helpers";
import type { TestStack } from "./test-stack";

// biome-ignore lint/suspicious/noConsole: stack-internal status logging
const logInfo = (msg: string): void => console.log(msg);

/**
 * Push all implicit-projection tables — one per `r.entity()` — that the
 * registry knows about. setupTestStack already handles explicit
 * projections, MSPs, and `r.rawTable()` declarations in its own loop;
 * implicit projections are the missing piece for a fresh boot.
 *
 * Idempotent via `tableExists` so a persistent dev DB
 * (`KUMIKO_DEV_DB_NAME`) reuses existing tables on reboot. One batched
 * push at the end so drizzle-kit's `generateMigration` runs once over
 * the whole missing set.
 *
 * Lives next to `setupTestStack` because both are stack-bootstrap
 * helpers that legitimately speak the `unsafe*`-DDL layer; the
 * Table-DDL Guard's stack/** allowlist is the single shared exemption
 * site. Apps still declare data via `r.entity()` / `r.rawTable()` and
 * never call this directly.
 */
export async function pushEntityProjectionTables(
  stack: TestStack,
  registry: Registry,
): Promise<void> {
  const seen = new Set<unknown>();
  const missing: Record<string, unknown> = {};

  for (const [projName, proj] of registry.getAllProjections()) {
    if (!proj.isImplicit) continue;
    if (seen.has(proj.table)) continue;
    seen.add(proj.table);
    // @cast-boundary drizzle-bridge — ProjectionTable + PgTable both round-trip
    // through getTableName at runtime; the type system can't unify them.
    const physical = getTableName(proj.table as Parameters<typeof getTableName>[0]);
    if (await tableExists(stack.db, `public.${physical}`)) {
      logInfo(`[kumiko-stack] table ${physical} already exists — skipping create`);
      continue;
    }
    missing[projName] = proj.table;
  }

  if (Object.keys(missing).length > 0) {
    await unsafePushTables(stack.db, missing);
  }
}

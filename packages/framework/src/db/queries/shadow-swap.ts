// Online projection rebuild via a transient shadow schema.
//
// Why a shadow SCHEMA and not a `read_foo__rebuild` table: apply(event, tx)
// writes through the projection's canonical table object → an unqualified
// `read_foo`. A captured table reference can't be re-pointed, so we redirect
// NAME RESOLUTION instead of the write: build the shadow under the SAME name
// in a private schema, point `search_path` there for the rebuild tx, and apply
// lands in the shadow untouched. The live `read_foo` keeps serving reads and
// writes for the whole replay — only the final swap takes a brief ACCESS
// EXCLUSIVE lock, instead of holding it for the entire replay like an
// in-place TRUNCATE + replay would.
//
// The shadow-schema choice also dissolves the index-rename problem: indexes
// built in the shadow carry their canonical `read_foo_*` names and move intact
// when the table is moved to public via SET SCHEMA.
//
// Boundary: the shadow table is rebuilt from EntityTableMeta, so any index NOT
// expressed in meta (hand-added in a migration) is not reconstructed, and a
// partial index whose WHERE the renderer can't express is rejected up-front.

import type { EntityTableMeta } from "../entity-table-meta";
import { type AnyDb, asEntityTableMeta, asRawClient } from "../query";
import { renderTableDdl } from "../render-ddl";
import { quoteTableIdent } from "./table-ops";

export const PROJECTION_REBUILD_SCHEMA = "kumiko_rebuild";

const SCHEMA_IDENT = quoteTableIdent(PROJECTION_REBUILD_SCHEMA);

function isDuplicateSchemaError(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("code" in e)) return false;
  const { code } = e;
  // 42P06 duplicate_schema, 23505 unique_violation on pg_namespace — both
  // surface from the well-known CREATE SCHEMA IF NOT EXISTS race.
  return code === "42P06" || code === "23505";
}

// Idempotent. MUST run OUTSIDE the rebuild tx: CREATE SCHEMA IF NOT EXISTS is
// not race-free (two concurrent rebuilds of DIFFERENT projections can collide
// on pg_namespace), and a collision inside the rebuild tx would roll the whole
// replay back. The dup race is swallowed; anything else (e.g. a role without
// CREATE privilege) rethrows so ops sees it loud.
export async function ensureRebuildSchema(db: AnyDb): Promise<void> {
  try {
    await asRawClient(db).unsafe(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_IDENT}`);
  } catch (e) {
    if (!isDuplicateSchemaError(e)) throw e;
  }
}

// Resolve the canonical EntityTableMeta a projection's table object carries,
// or throw. Online rebuild needs the full column+index shape to build the
// shadow table; a meta-inexpressible partial index would be silently dropped
// by the renderer, so reject it up-front instead of swapping in a table that
// is missing an index.
export function rebuildMetaOrThrow(table: unknown, projectionName: string): EntityTableMeta {
  const meta = asEntityTableMeta(table);
  if (!meta) {
    throw new Error(
      `Projection "${projectionName}" has no resolvable EntityTableMeta — online rebuild needs it to build the shadow table.`,
    );
  }
  if (meta.indexes.some((idx) => idx.needsManualWhere === true)) {
    throw new Error(
      `Projection "${projectionName}" has a partial index whose WHERE clause the schema renderer can't express (drizzle sql\`…\`). Online rebuild reconstructs the table from meta and would silently drop that index. Make the WHERE renderable or rebuild this projection offline.`,
    );
  }
  return meta;
}

// Runs INSIDE the rebuild tx, AFTER the state/consumer row lock is taken.
// Points search_path at the shadow schema (SET LOCAL → auto-reset on commit or
// rollback), drops any leftover shadow from a crashed run, then builds the
// shadow table + indexes under their canonical names. renderTableDdl output and
// apply-writes are unqualified and resolve into the shadow; kumiko_events /
// kumiko_projections live only in public and fall through to it.
//
// Boundary: an apply that writes to a table OTHER than its own projection (e.g.
// an MSP saga touching a second read-model) writes UNQUALIFIED → resolves to
// public, i.e. the live secondary table, not a shadow of it. Online rebuild is
// safe for self-table-only apply (the common case); a multi-table apply would
// mutate live state during replay.
export async function buildShadowTable(tx: AnyDb, meta: EntityTableMeta): Promise<void> {
  const raw = asRawClient(tx);
  await raw.unsafe(`SET LOCAL search_path TO ${SCHEMA_IDENT}, public`);
  await raw.unsafe(`DROP TABLE IF EXISTS ${SCHEMA_IDENT}.${quoteTableIdent(meta.tableName)}`);
  for (const stmt of renderTableDdl(meta)) {
    await raw.unsafe(stmt);
  }
}

// Atomic swap, INSIDE the rebuild tx, AFTER replay. Schema-qualified so the
// active shadow search_path can't redirect them. DROP without CASCADE: if any
// object depends on the live table the swap fails loud and the whole rebuild
// rolls back, leaving the old table untouched.
export async function swapShadowIntoLive(tx: AnyDb, tableName: string): Promise<void> {
  const raw = asRawClient(tx);
  const ident = quoteTableIdent(tableName);
  await raw.unsafe(`DROP TABLE public.${ident}`);
  await raw.unsafe(`ALTER TABLE ${SCHEMA_IDENT}.${ident} SET SCHEMA public`);
}

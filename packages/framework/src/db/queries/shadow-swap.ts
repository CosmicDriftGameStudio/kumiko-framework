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

import type { DbConnection, DbTx } from "../connection";
import type { EntityTableMeta } from "../entity-table-meta";
import { type AnyDb, asEntityTableMeta, asRawClient } from "../query";
import { renderTableDdl } from "../render-ddl";
import { columnNamesOf, tableExists } from "../schema-inspection";
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

// Fence against a rebuild running with a registry that does not match the
// migrated live schema (#835): during a rolling deploy, a pod still running
// the previous build can pick up an async rebuild job; its shadow — built from
// the stale EntityTableMeta — would swap away a freshly-migrated column
// (recurrence class of #494). Compares COLUMN NAMES only; a type-/nullability-
// only drift passes (schema regression, not data loss — the boot gate of the
// next deploy catches it). A missing live table is fine: nothing to wipe.
// Must run BEFORE buildShadowTable; columnNamesOf pins table_schema='public',
// so the shadow search_path could not redirect it anyway.
export async function assertLiveColumnsMatchMeta(
  db: DbConnection | DbTx,
  meta: EntityTableMeta,
  projectionName: string,
): Promise<void> {
  // skip: no live table yet — nothing a stale-meta shadow could wipe
  if (!(await tableExists(db, `public.${meta.tableName}`))) return;
  const live = await columnNamesOf(db, meta.tableName);
  const metaNames = new Set(meta.columns.map((c) => c.name));
  const onlyLive = [...live].filter((c) => !metaNames.has(c));
  const onlyMeta = [...metaNames].filter((c) => !live.has(c));
  // skip: column sets match — this process's registry is in sync with the migrated table
  if (onlyLive.length === 0 && onlyMeta.length === 0) return;
  const detail = [
    onlyLive.length > 0 ? `live-only: ${onlyLive.join(", ")}` : "",
    onlyMeta.length > 0 ? `meta-only: ${onlyMeta.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  throw new Error(
    `projection-rebuild "${projectionName}": columns of live table "${meta.tableName}" do not match this process's EntityTableMeta (${detail}). ` +
      "Rebuilding would swap away the difference. Likely cause: this pod runs a build whose registry is behind (or ahead of) the applied migrations — rolling deploy in progress? — or DDL was applied by hand. " +
      "Rebuild aborted; retry from a pod whose code matches the migrated schema.",
  );
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

// Fence the live table before the cutover: take ACCESS EXCLUSIVE on
// public.<tableName> so no concurrent synchronous projection apply (a command
// handler's append+apply) can commit a new event-derived row past the rebuild's
// final catch-up. Schema-qualified so the active shadow search_path can't
// redirect it. lock_timeout (SET LOCAL → auto-reset) bounds the wait: under a
// pathological long-running writer the fence fails loud and the rebuild rolls
// back rather than hanging indefinitely.
export async function fenceLiveTable(
  tx: AnyDb,
  tableName: string,
  lockTimeoutMs: number,
): Promise<void> {
  // Postgres treats lock_timeout = 0 as "no timeout" (wait forever) — the
  // opposite of fail-fast. Reject it so a 0/negative value can't silently
  // turn the fence into an unbounded wait.
  if (Math.trunc(lockTimeoutMs) <= 0) {
    throw new Error(`fenceLockTimeoutMs must be > 0, got ${lockTimeoutMs}`);
  }
  const raw = asRawClient(tx);
  await raw.unsafe(`SET LOCAL lock_timeout = ${Math.trunc(lockTimeoutMs)}`);
  await raw.unsafe(`LOCK TABLE public.${quoteTableIdent(tableName)} IN ACCESS EXCLUSIVE MODE`);
}

// Ids reported when the swap is aborted — enough to locate the ghost rows
// without dumping an unbounded set into the log.
const UNREACHABLE_SAMPLE_LIMIT = 20;

// Runs INSIDE the rebuild tx, under the fence, before swapShadowIntoLive. A live
// row whose aggregate id has NO event in the projection's source streams is
// UNREACHABLE: no replay can ever reconstruct it, so the swap would silently
// drop it. That is the #498 ghost — a row direct-inserted without ever emitting
// a .created event. The static CI guard cannot see it in data that already
// exists in production, or on table identifiers it couldn't resolve; this
// catches it at cutover and aborts (tx rolls back, live untouched).
//
// Deliberately NARROW — event EXISTENCE only, not a column or row-vs-shadow
// diff. The framework legitimately makes live diverge from a fresh replay in
// several SHIPPED ways, none of which is drift:
//   - a blind-index column recomputed to NULL after the subject's key is
//     shredded (GDPR erase) — the NULL is the intended end state;
//   - a `sensitive` column stripped from the event log by design;
//   - an archived stream that stops replaying (fw#832) — the row's wipe is the
//     intended tombstone behavior, reported via backfill's `failed` list;
//   - a legacy column direct-written before its handler emitted events, healed
//     by the #494 backfill-then-rebuild flow.
// Checking event existence INCLUDING archived streams leaves every one of them
// alone: those rows all have a real event, so they are not ghosts. Column-level
// drift detection (fail-hard vs. graceful repair) is the open question deferred
// from #722.
//
// Implicit projections only (caller-gated). aggregate_id and the entity id are
// both uuid, so the anti-join probes the events index without a cast.
export async function assertNoUnreachableLiveRows(
  tx: AnyDb,
  projectionName: string,
  tableName: string,
  aggregateTypes: readonly string[],
): Promise<void> {
  // skip: no source streams → no events could back any row anyway; a rebuild
  // of a subscription-less projection swaps an empty shadow (handled upstream).
  if (aggregateTypes.length === 0) return;
  const raw = asRawClient(tx);
  const t = quoteTableIdent(tableName);
  const ghosts = await raw.unsafe<{ id: unknown }>(
    `SELECT l."id" FROM public.${t} l
     WHERE NOT EXISTS (
       SELECT 1 FROM "kumiko_events" e
        WHERE e."aggregate_id" = l."id" AND e."aggregate_type" = ANY($1::text[])
     )
     LIMIT ${UNREACHABLE_SAMPLE_LIMIT}`,
    [aggregateTypes],
  );
  // skip: every live row has a backing event — nothing unreachable, swap is safe
  if (ghosts.length === 0) return;
  const ids = ghosts.map((r) => String(r.id));
  const countLabel =
    ids.length === UNREACHABLE_SAMPLE_LIMIT ? `${ids.length}+` : String(ids.length);
  throw new Error(
    `projection-rebuild "${projectionName}": ${countLabel} live rows in "${tableName}" have no ` +
      `event in the projection's source streams and cannot be reconstructed by replay — the swap ` +
      `would silently drop them (ids: ${ids.join(", ")}). A handler direct-inserted these rows ` +
      `without emitting a .created event. Fix: register the table with r.unmanagedTable(meta, ` +
      `{ reason }) to opt out of rebuild, or emit the missing events. See ` +
      `docs/reference/entity-write-patterns.md. Rebuild aborted; live table untouched.`,
  );
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

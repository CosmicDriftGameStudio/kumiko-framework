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

// Ids reported per direction when the swap is aborted — enough to locate the
// drifting rows without dumping an unbounded set into the log.
const UNREACHABLE_SAMPLE_LIMIT = 20;

// Runs INSIDE the rebuild tx, under the fence, AFTER the shadow is fully
// replayed and BEFORE swapShadowIntoLive. The shadow is the deterministic
// replay of every subscribed lifecycle event; any row in the live table that
// the replay does not reproduce is state that was direct-written WITHOUT a
// matching event (#494/#523/#525 class) — the swap would silently drop it.
// This enforces at cutover the same live==rebuild invariant the executor path
// is tested for (implicit-projection-equivalence), catching drift the static
// CI guard can't see: pre-existing production data, or writes on table
// identifiers the guard couldn't resolve.
//
// Compares an EXPLICIT column list (meta order), NOT `SELECT *`: EXCEPT matches
// by position, and the live table's physical column order may differ from the
// shadow's meta-derived order (a column added by a later migration lands last
// in live but mid-list in meta). Projecting both sides through the same ordered
// name list makes the diff order-independent. Column NAME sets are already
// pinned equal by assertLiveColumnsMatchMeta before the shadow is built.
//
// Both directions abort:
//   live-only  → rows the swap would WIPE (direct insert/update without event)
//   shadow-only→ rows the swap would RESURRECT (direct delete without event —
//                e.g. a GDPR-forgotten row replay brings back, #494)
//
// Implicit projections only (caller-gated): explicit projections are derived
// entirely inside apply(), and a multi-table apply legitimately writes live
// secondary state during replay — a live/shadow diff there is not drift.
//
// ponytail: two full EXCEPT scans under the ACCESS EXCLUSIVE fence — O(table),
// widens the write-stall window by one table pass. If that bites on very large
// projections, gate on a cheaper md5(string_agg(row ORDER BY id)) hash first
// and only run the row-diff on hash mismatch.
export async function assertShadowCoversLive(
  tx: AnyDb,
  meta: EntityTableMeta,
  projectionName: string,
  unreproducibleColumns: readonly string[] = [],
): Promise<void> {
  const raw = asRawClient(tx);
  const t = quoteTableIdent(meta.tableName);
  // Columns the executor strips from the event log (sensitive fields) can never
  // be reproduced by replay — comparing them would flag every such row as drift
  // (the documented Wave-3 rebuild gap). Row-existence and all reproducible
  // column drift stay covered.
  const skip = new Set(unreproducibleColumns);
  const cols = meta.columns
    .filter((c) => !skip.has(c.name))
    .map((c) => quoteTableIdent(c.name))
    .join(", ");
  const live = `SELECT ${cols} FROM public.${t}`;
  const shadow = `SELECT ${cols} FROM ${SCHEMA_IDENT}.${t}`;

  const idsOf = async (a: string, b: string): Promise<string[]> => {
    const rows = await raw.unsafe<{ id: unknown }>(
      `SELECT id FROM (${a} EXCEPT ${b}) d LIMIT ${UNREACHABLE_SAMPLE_LIMIT}`,
    );
    return rows.map((r) => String(r.id));
  };
  const liveOnly = await idsOf(live, shadow);
  const shadowOnly = await idsOf(shadow, live);
  if (liveOnly.length === 0 && shadowOnly.length === 0) return;

  const dir = [
    liveOnly.length > 0
      ? `${liveOnly.length}+ live rows the swap would WIPE (ids: ${liveOnly.join(", ")})`
      : "",
    shadowOnly.length > 0
      ? `${shadowOnly.length}+ rows the replay would RESURRECT (ids: ${shadowOnly.join(", ")})`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  throw new Error(
    `projection-rebuild "${projectionName}": live table "${meta.tableName}" holds state not reproducible from its event log — ${dir}. ` +
      "A handler direct-wrote this table without emitting matching lifecycle events, so the rebuild's event replay can't reconstruct it and the swap would lose it. " +
      "Fix: register the table with r.unmanagedTable(meta, { reason }) to opt it out of rebuild, or emit the missing .created/.updated/.deleted events. " +
      "See docs/reference/entity-write-patterns.md. Rebuild aborted; live table untouched.",
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

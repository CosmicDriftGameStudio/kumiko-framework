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

import { isUuid, parseTenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { ProjectionRowIdOf } from "@cosmicdrift/kumiko-types/projection";
import { configuredBlindIndexKey } from "../../crypto/index.js";
import type { DbConnection, DbTx } from "../connection.js";
import type { EntityTableMeta } from "../entity-table-meta.js";
import { type AnyDb, asEntityTableMeta, asRawClient } from "../query.js";
import { renderTableDdl } from "../render-ddl.js";
import { columnNamesOf, tableExists } from "../schema-inspection.js";
import { quoteTableIdent } from "./table-ops.js";

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

// EntityTableMeta carries no RLS/policies, so the swap would silently drop them (#2907).
export async function assertLiveTableHasNoRowLevelSecurity(
  tx: AnyDb,
  tableName: string,
  projectionName?: string,
): Promise<void> {
  const rows = await asRawClient(tx).unsafe<{
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_count: number;
  }>(
    `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [tableName],
  );
  const row = rows[0];
  // skip: no live table yet — nothing to have RLS on
  if (!row) return;
  // skip: no RLS flags and no policies — nothing the swap could drop
  if (!row.rls_enabled && !row.rls_forced && row.policy_count === 0) return;
  const context =
    projectionName !== undefined ? `projection-rebuild "${projectionName}"` : "shadow swap";
  throw new Error(
    `${context}: live table "${tableName}" has row level security (enabled: ${row.rls_enabled}, ` +
      `forced: ${row.rls_forced}, policies: ${row.policy_count}). The shadow swap rebuilds the table ` +
      "from EntityTableMeta and would silently drop RLS and every policy. Kumiko does not support RLS " +
      "on rebuildable tables: drop the RLS flags/policies on this table or exclude it from online " +
      "rebuild. Rebuild aborted; live table untouched.",
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
// drift is a SEPARATE, non-blocking check — see countColumnDrift below (#916,
// resolves the #722 open question: observe, don't block).
//
// Implicit projections only (caller-gated). aggregate_id and the entity id are
// both uuid, so the anti-join probes the events index without a cast.
//
// Source streams whose rows are keyed by a DERIVED id (r.extendEntityProjection
// `rowIdOf`, e.g. tenant-salted) cannot be matched on aggregate_id: their
// distinct (tenant, aggregate) pairs are mapped through rowIdOf into a temp
// table, and a live row is backed when its id is in that set. The guard stays
// strict — a row keyed by the raw aggregate id of a derived stream is a ghost.
const DERIVED_ROW_ID_BATCH_SIZE = 5000;
const DERIVED_ROW_ID_TABLE = "pg_temp.kumiko_derived_row_ids";

type EventKeyRow = { tenant_id: string; aggregate_id: string };

async function fillDerivedRowIdTable(
  raw: ReturnType<typeof asRawClient>,
  projectionName: string,
  aggregateType: string,
  rowIdOf: ProjectionRowIdOf,
): Promise<void> {
  let cursor: EventKeyRow | undefined;
  for (;;) {
    const page: readonly EventKeyRow[] = await raw.unsafe<EventKeyRow>(
      `SELECT DISTINCT "tenant_id"::text AS tenant_id, "aggregate_id"::text AS aggregate_id
         FROM "kumiko_events"
        WHERE "aggregate_type" = $1
          ${cursor ? `AND ("tenant_id", "aggregate_id") > ($2::uuid, $3::uuid)` : ""}
        ORDER BY "tenant_id", "aggregate_id"
        LIMIT ${DERIVED_ROW_ID_BATCH_SIZE}`,
      cursor ? [aggregateType, cursor.tenant_id, cursor.aggregate_id] : [aggregateType],
    );
    // skip: keyset exhausted — every source event of this type has been mapped
    if (page.length === 0) return;
    const derivedIds = page.map((row) => {
      const tenantId = parseTenantId(row.tenant_id);
      if (tenantId === null) {
        throw new Error(
          `projection-rebuild "${projectionName}": event of aggregate type "${aggregateType}" ` +
            `carries a non-uuid tenant_id "${row.tenant_id}".`,
        );
      }
      const derived = rowIdOf({ tenantId, aggregateId: row.aggregate_id });
      if (!isUuid(derived)) {
        throw new Error(
          `projection-rebuild "${projectionName}": rowIdOf for aggregate type "${aggregateType}" ` +
            `returned "${String(derived)}", which is not a uuid (aggregate ${row.aggregate_id}).`,
        );
      }
      return derived;
    });
    await raw.unsafe(
      `INSERT INTO ${DERIVED_ROW_ID_TABLE} ("id") SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING`,
      [derivedIds],
    );
    // skip: a short page is the last one
    if (page.length < DERIVED_ROW_ID_BATCH_SIZE) return;
    cursor = page[page.length - 1];
  }
}

export async function assertNoUnreachableLiveRows(
  tx: AnyDb,
  projectionName: string,
  tableName: string,
  aggregateTypes: readonly string[],
  derivedRowIds: Readonly<Record<string, ProjectionRowIdOf>> = {},
): Promise<void> {
  // skip: no source streams → no events could back any row anyway; a rebuild
  // of a subscription-less projection swaps an empty shadow (handled upstream).
  if (aggregateTypes.length === 0) return;
  const raw = asRawClient(tx);
  const t = quoteTableIdent(tableName);
  const derivedTypes = aggregateTypes.filter((type) => derivedRowIds[type] !== undefined);
  const directTypes = aggregateTypes.filter((type) => derivedRowIds[type] === undefined);
  if (derivedTypes.length > 0) {
    // search_path points at the shadow schema here; pg_temp is addressed explicitly.
    await raw.unsafe(
      `CREATE TEMP TABLE IF NOT EXISTS kumiko_derived_row_ids ("id" uuid PRIMARY KEY) ON COMMIT DROP`,
    );
    await raw.unsafe(`TRUNCATE ${DERIVED_ROW_ID_TABLE}`);
    for (const aggregateType of derivedTypes) {
      const rowIdOf = derivedRowIds[aggregateType];
      // skip: filtered by derivedTypes above, narrows the Record lookup for the compiler
      if (rowIdOf === undefined) continue;
      await fillDerivedRowIdTable(raw, projectionName, aggregateType, rowIdOf);
    }
  }
  const unbackedClauses: string[] = [];
  if (directTypes.length > 0) {
    unbackedClauses.push(
      `NOT EXISTS (
         SELECT 1 FROM "kumiko_events" e
          WHERE e."aggregate_id" = l."id" AND e."aggregate_type" = ANY($1::text[])
       )`,
    );
  }
  if (derivedTypes.length > 0) {
    unbackedClauses.push(
      `NOT EXISTS (SELECT 1 FROM ${DERIVED_ROW_ID_TABLE} d WHERE d."id" = l."id")`,
    );
  }
  const ghosts = await raw.unsafe<{ id: unknown }>(
    `SELECT l."id" FROM public.${t} l
     WHERE ${unbackedClauses.join(" AND ")}
     LIMIT ${UNREACHABLE_SAMPLE_LIMIT}`,
    directTypes.length > 0 ? [directTypes] : [],
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
      `without emitting a .created event. Fix: register the table with r.storeTable(meta, ` +
      `{ reason }) to opt out of rebuild, or emit the missing events. Rows keyed by an id ` +
      `derived from the source event declare \`rowIdOf\` on r.extendEntityProjection. See ` +
      `docs/reference/entity-write-patterns.md. Rebuild aborted; live table untouched.`,
  );
}

// The bidx column is schema-driven, not key-driven: it exists NULL in a
// plaintext install and in the fw#1610 case (KMS configured, no index key),
// both of which are correct as-is. Only a POPULATED column with no key
// configured in THIS process means the rebuild is about to overwrite proof
// of a real index with NULL — that's the one provable data-loss case.
export async function assertNoBlindIndexLoss(
  tx: AnyDb,
  tableName: string,
  meta: EntityTableMeta,
  projectionName: string,
): Promise<void> {
  // skip: a key is configured — the replay recomputes every bidx column with it
  if (configuredBlindIndexKey() !== undefined) return;
  const bidxCols = meta.columns.filter((c) => c.name.endsWith("_bidx"));
  // skip: no blind-index column on this table — nothing the rebuild could lose
  if (bidxCols.length === 0) return;
  const t = quoteTableIdent(tableName);
  const raw = asRawClient(tx);
  const where = bidxCols.map((c) => `${quoteTableIdent(c.name)} IS NOT NULL`).join(" OR ");
  const rows = await raw.unsafe<{ total: string }>(
    `SELECT count(*)::text AS total FROM public.${t} WHERE ${where}`,
  );
  const count = Number(rows[0]?.total ?? "0");
  // skip: every bidx column is already NULL — nothing for the rebuild to lose
  if (count === 0) return;
  throw new Error(
    `projection-rebuild "${projectionName}": "${tableName}" has ${count} row(s) with a populated ` +
      `blind-index column, but KUMIKO_BLIND_INDEX_KEY is not configured in this process. The rebuild ` +
      `would recompute those columns to NULL, and equality lookups on that field (login, password ` +
      `reset) would stop matching afterward. Configure the complete KMS wiring (PLATFORM_KEK, ` +
      `SUBJECT_KEYS_DATABASE_URL, KUMIKO_BLIND_INDEX_KEY, all-or-none) in the process running this ` +
      `apply/rebuild. See fw#3091. Rebuild aborted; live table untouched.`,
  );
}

// Columns ignored by countColumnDrift — the one PROVABLY legitimate class of
// live-vs-shadow divergence. A blind-index column (`<field>_bidx`) is
// recomputed to NULL on GDPR key-shredding; the NULL is the intended end
// state, not drift. Everything else that legitimately diverges (archived
// streams, #494 backfill) either never reaches this comparison (archived rows
// are absent from the shadow entirely, see swapShadowIntoLive) or IS real
// column drift that the #494 backfill-then-rebuild flow relies on replay to
// heal — reporting it (without blocking) is correct, not a false positive.
const COLUMN_DRIFT_SAMPLE_LIMIT = 20;

export type ColumnDriftResult = {
  readonly rowCount: number;
  // Capped sample of "<id>.<column>" pairs for log/ops triage.
  readonly sample: readonly string[];
};

// Runs INSIDE the rebuild tx, in the same slot as assertNoUnreachableLiveRows
// (after replay settles, before swapShadowIntoLive). Non-blocking counterpart
// to the ghost-row guard: reports live rows whose column values differ from
// the freshly-replayed shadow, WITHOUT aborting the swap (#916, resolves the
// #722 open question in favor of observe-not-block).
//
// Why non-blocking: a legacy column direct-written before its handler emitted
// events (#494) diverges from replay by design — that divergence is exactly
// what the backfill-then-rebuild flow relies on replay to heal. Failing hard
// here would make rebuild mutually exclusive with that shipped healing path.
// There is no reliable metadata to distinguish "#494 healing in progress" from
// "someone else corrupted this row" short of an open-ended per-column policy
// blocklist — wrong-by-default whenever a class is missed. So: surface it,
// don't police it. The caller logs the result; ops decides.
//
// Caveat: sensitive CUSTOM fields still diverge until #972 (Subject-DEK
// design) — regular sensitive fields carry event-payload ciphertext parity
// post-#973 and don't drift. Both are reported the same as any other column
// drift; this is deliberate (see module comment above), not an oversight.
//
// Relies on assertLiveColumnsMatchMeta having already run: live/shadow/meta
// column sets are known to match, so the diff can walk meta.columns directly.
export async function countColumnDrift(
  tx: AnyDb,
  tableName: string,
  meta: EntityTableMeta,
): Promise<ColumnDriftResult> {
  const comparable = meta.columns.filter((c) => c.primaryKey !== true && !c.name.endsWith("_bidx"));
  // skip: nothing to compare (id-only or all-bidx table) — no drift is possible
  if (comparable.length === 0) return { rowCount: 0, sample: [] };
  const t = quoteTableIdent(tableName);
  const raw = asRawClient(tx);
  const driftCte = `WITH drifted AS (
     SELECT l."id" AS id, string_agg(diff.col, ',') AS drifted_columns
     FROM public.${t} l
     JOIN ${SCHEMA_IDENT}.${t} s ON s."id" = l."id"
     CROSS JOIN LATERAL (
       VALUES ${comparable
         .map(
           (c) =>
             `('${c.name}', l.${quoteTableIdent(c.name)} IS DISTINCT FROM s.${quoteTableIdent(c.name)})`,
         )
         .join(", ")}
     ) AS diff(col, differs)
     WHERE diff.differs
     GROUP BY l."id"
   )`;
  // Two passes over `drifted`: an unbounded COUNT for the true total (replay
  // already scanned every row this run, so a second scan here is cheap by
  // comparison) plus a capped sample for the log. rowCount must NEVER be
  // min(actual, LIMIT) — that would silently understate severity to ops.
  const totalRows = await raw.unsafe<{ total: string }>(
    `${driftCte} SELECT count(*)::text AS total FROM drifted`,
  );
  const rowCount = Number(totalRows[0]?.total ?? "0");
  // skip: no drift — nothing to sample
  if (rowCount === 0) return { rowCount: 0, sample: [] };
  const rows = await raw.unsafe<{ id: unknown; drifted_columns: string }>(
    `${driftCte} SELECT id, drifted_columns FROM drifted LIMIT ${COLUMN_DRIFT_SAMPLE_LIMIT}`,
  );
  const sample = rows.flatMap((r) =>
    r.drifted_columns.split(",").map((col) => `${String(r.id)}.${col}`),
  );
  return { rowCount, sample };
}

// Atomic swap, INSIDE the rebuild tx, AFTER replay. Schema-qualified so the
// active shadow search_path can't redirect them. DROP without CASCADE: if any
// object depends on the live table the swap fails loud and the whole rebuild
// rolls back, leaving the old table untouched.
export async function swapShadowIntoLive(tx: AnyDb, tableName: string): Promise<void> {
  const raw = asRawClient(tx);
  const ident = quoteTableIdent(tableName);
  // Held before the re-check so a concurrent ENABLE ROW LEVEL SECURITY either commits first
  // (and is seen) or waits behind the DROP. Without it the catalog read takes no lock, and
  // the unfenced paths (MSP rebuild, projection with no subscribed events) would drop RLS.
  await raw.unsafe(`LOCK TABLE public.${ident} IN ACCESS EXCLUSIVE MODE`);
  await assertLiveTableHasNoRowLevelSecurity(tx, tableName);
  await raw.unsafe(`DROP TABLE public.${ident}`);
  await raw.unsafe(`ALTER TABLE ${SCHEMA_IDENT}.${ident} SET SCHEMA public`);
}

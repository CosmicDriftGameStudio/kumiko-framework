import { escapeLikePattern } from "../crypto/ciphertext-pattern.ts";
import {
  buildOwnershipClause,
  normalizeAccessEntry,
  type OwnershipClause,
  shiftParams,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { EntityDefinition, SessionUser, TenantId } from "../engine/types/index.ts";
import { UnprocessableError } from "../errors/index.ts";
import type { SearchAdapter } from "../search/types.ts";
import { LIST_ROW_META_REFERENCES } from "../ui-types/list-row-meta.ts";
import { hasSearchablePlaintext, isSensitiveLabelField } from "./entity-field-encryption.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { Table } from "./event-store-executor-context.ts";
import { bindPlaceholders, type ListWhere } from "./event-store-executor-read-filter.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { buildEntityTable, physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb, TenantDbMode } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// Above this many target-row matches, drop the reference clause
// entirely instead of truncating: an arbitrary 200-row slice of "which
// targets match" would silently hide rows a full-cardinality match would
// have found. Native text search on the entity's own fields still applies.
const MAX_REFERENCE_SEARCH_IDS = 200;

// The hit ids become an `id IN (...)` filter beneath the SQL cursor/filters/sort, so the
// adapter must return the whole candidate set, not a page; matches Meilisearch's default
// maxTotalHits, which caps a response at exactly this many hits however high a larger limit is
// asked. A response that reaches the cap is therefore flagged `searchTruncated` rather than
// treated as complete (a cap of N+1 could never be observed).
const MAX_SEARCH_CANDIDATE_IDS = 1000;

type ReferenceSearchOption = NonNullable<
  Parameters<EventStoreExecutor["list"]>[3]
>["referenceSearch"];

type ReferenceMatch = { readonly ownColumn: string; readonly ids: readonly string[] };

type ReferenceSearchDescriptor = {
  readonly ownColumn: string;
  readonly targetEntityName: string;
  readonly labelField: string;
};

// Registry-declared `searchable` reference fields, plus the implicit
// tenantId→tenant.name row-meta reference — both resolve a text
// search term against a target row's label instead of the raw FK column.
function collectReferenceSearchDescriptors(
  table: Table,
  referenceSearch: ReferenceSearchOption,
  dbMode: TenantDbMode,
): readonly ReferenceSearchDescriptor[] {
  if (!referenceSearch) return [];
  const descriptors: ReferenceSearchDescriptor[] = referenceSearch.fields.map((f) => ({
    ownColumn: f.fieldName,
    targetEntityName: f.targetEntityName,
    labelField: f.labelField,
  }));
  for (const [ownColumn, ref] of Object.entries(LIST_ROW_META_REFERENCES)) {
    if (table[ownColumn] === undefined) continue;
    // In "tenant" mode the outer tenant filter already pins tenantId to one
    // of exactly two values, so a by-name lookup here can never narrow that further.
    if (ownColumn === "tenantId" && dbMode === "tenant") continue;
    descriptors.push({ ownColumn, targetEntityName: ref.refEntity, labelField: ref.refLabelField });
  }
  return descriptors;
}

// Matches the main list's own default: soft-deleted rows are invisible, so a
// deleted target must neither match a search nor influence an ordering.
export function isSoftDeletedTargetHidden(
  targetEntity: EntityDefinition,
  targetTable: Table,
): boolean {
  return targetEntity.softDelete === true && targetTable["isDeleted"] !== undefined;
}

// Tenant-scoped ILIKE lookup against one reference target — never raw/
// unscoped SQL, a match in a foreign tenant must never surface a row here.
// Mirrors the main table's own tenant filter (see the `table["tenantId"]`
// check further down in list()).
async function resolveReferenceMatchesViaIlike(
  descriptor: ReferenceSearchDescriptor,
  searchTerm: string,
  targetEntity: EntityDefinition,
  targetTable: Table,
  targetTableName: string,
  user: SessionUser,
  db: TenantDb,
): Promise<ReferenceMatch | undefined> {
  // The label must not leak through match counts: a viewer who cannot read the
  // target row or its label field would otherwise probe names by searching.
  const labelAccess = buildOwnershipClause(
    user,
    normalizeAccessEntry(targetEntity.fields[descriptor.labelField]?.access?.read),
    targetTable,
  );
  if (labelAccess.kind !== "pass") return undefined;
  const ownership = buildOwnershipClause(user, targetEntity.access?.read, targetTable);
  if (ownership.kind === "empty") return undefined;

  const labelCol = physicalColumnName(targetTable, descriptor.labelField);
  const subParams: unknown[] = [`%${escapeLikePattern(searchTerm)}%`];
  let tenantClause = "";
  if (targetTable["tenantId"] !== undefined && db.mode === "tenant") {
    subParams.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantClause = ` AND "${physicalColumnName(targetTable, "tenantId")}" IN ($2, $3)`;
  }
  let ownershipClause = "";
  if (ownership.kind === "sql") {
    const shifted = shiftParams(
      { sqlText: ownership.sqlText, params: ownership.params },
      subParams.length,
    );
    ownershipClause = ` AND ${shifted.sqlText}`;
    for (const p of shifted.params) subParams.push(p);
  }
  const deletedClause = isSoftDeletedTargetHidden(targetEntity, targetTable)
    ? ` AND "${physicalColumnName(targetTable, "isDeleted")}" = FALSE`
    : "";
  // ::text cast covers a non-text labelField (e.g. a number/select column
  // used as label) — Postgres has no ILIKE for those types otherwise.
  const sql =
    `SELECT "id" FROM "${targetTableName}" WHERE ("${labelCol}")::text ILIKE $1${tenantClause}${ownershipClause}${deletedClause} ` +
    `LIMIT ${MAX_REFERENCE_SEARCH_IDS + 1}`;
  const rows = await executeRawQueryRead<{ id: string }>(tenantDbRunner(db), sql, subParams);
  if (rows.length === 0 || rows.length > MAX_REFERENCE_SEARCH_IDS) {
    // skip: no match, or over the cap — drop the clause rather than
    // truncate to an arbitrary slice of matching targets
    return undefined;
  }
  return { ownColumn: descriptor.ownColumn, ids: rows.map((r) => r.id) };
}

// Same lookup, but the target's index is tenant-wide, not per-viewer, so
// candidate ids get re-checked against the target entity's own read access.
async function resolveReferenceMatchesViaSearchIndex(
  descriptor: ReferenceSearchDescriptor,
  searchTerm: string,
  targetEntity: EntityDefinition,
  targetTable: Table,
  targetTableName: string,
  user: SessionUser,
  db: TenantDb,
  searchAdapter: SearchAdapter,
): Promise<ReferenceMatch | undefined> {
  const searchTenantId = targetEntity.systemStream ? SYSTEM_TENANT_ID : user.tenantId;
  const results = await searchAdapter.search(searchTenantId, searchTerm, {
    filterType: descriptor.targetEntityName,
    limit: MAX_REFERENCE_SEARCH_IDS + 1,
  });
  if (results.length === 0 || results.length > MAX_REFERENCE_SEARCH_IDS) {
    // skip: no match, or over the cap — same drop-the-clause policy as the ILIKE path
    return undefined;
  }

  const ownership = buildOwnershipClause(user, targetEntity.access?.read, targetTable);
  if (ownership.kind === "empty") return undefined;

  const candidateIds = results.map((r) => String(r.entityId));
  // The index is only trusted to name candidates: a stale or foreign-tenant document must
  // never become a filter value, so tenant-scoped targets are always re-read from the DB.
  const tenantScoped = targetTable["tenantId"] !== undefined && db.mode === "tenant";
  if (ownership.kind === "pass" && !tenantScoped) {
    return { ownColumn: descriptor.ownColumn, ids: candidateIds };
  }

  const params: unknown[] = [...candidateIds];
  const idPlaceholders = candidateIds.map((_, i) => `$${i + 1}`);
  let tenantClause = "";
  if (tenantScoped) {
    params.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantClause = ` AND "${physicalColumnName(targetTable, "tenantId")}" IN ($${params.length - 1}, $${params.length})`;
  }
  let ownershipClause = "";
  if (ownership.kind === "sql") {
    const shifted = shiftParams(
      { sqlText: ownership.sqlText, params: ownership.params },
      params.length,
    );
    for (const p of shifted.params) params.push(p);
    ownershipClause = ` AND ${shifted.sqlText}`;
  }
  const sql =
    `SELECT "id" FROM "${targetTableName}" WHERE "id" IN (${idPlaceholders.join(", ")})` +
    `${tenantClause}${ownershipClause}`;
  const rows = await executeRawQueryRead<{ id: string }>(tenantDbRunner(db), sql, params);
  if (rows.length === 0) return undefined;
  return { ownColumn: descriptor.ownColumn, ids: rows.map((r) => r.id) };
}

async function resolveReferenceMatches(
  descriptor: ReferenceSearchDescriptor,
  searchTerm: string,
  resolveEntity: (entityName: string) => EntityDefinition | undefined,
  db: TenantDb,
  user: SessionUser,
  searchAdapter: SearchAdapter,
): Promise<ReferenceMatch | undefined> {
  const targetEntity = resolveEntity(descriptor.targetEntityName);
  if (targetEntity === undefined) {
    // skip: unknown target entity — registry inconsistency the boot-validator
    // should have caught; fail open (no clause) rather than 500 the request
    return undefined;
  }
  if (targetEntity.fields[descriptor.labelField] === undefined) {
    // skip: labelField isn't a real (declared) column on the target entity —
    // row-meta references (e.g. tenant.name) always resolve here since
    // `name` is a declared field on the tenant entity, not an id/row-meta column
    return undefined;
  }

  const targetTable = referenceTargetTable(descriptor.targetEntityName, targetEntity);
  const targetTableName = String(schemaTableName(targetTable));

  if (!isSensitiveLabelField(targetEntity, descriptor.labelField)) {
    return resolveReferenceMatchesViaIlike(
      descriptor,
      searchTerm,
      targetEntity,
      targetTable,
      targetTableName,
      user,
      db,
    );
  }
  if (!hasSearchablePlaintext(targetEntity, descriptor.labelField)) {
    // skip: no plaintext anywhere to match — boot rejects this normally,
    // this is defense-in-depth for a target entity resolved only at runtime.
    return undefined;
  }
  return resolveReferenceMatchesViaSearchIndex(
    descriptor,
    searchTerm,
    targetEntity,
    targetTable,
    targetTableName,
    user,
    db,
    searchAdapter,
  );
}

// Building the table is pure but not free, and runs on every search request;
// keyed by the definition object so a re-registered entity never sees a stale table.
const referenceTargetTables = new WeakMap<EntityDefinition, { name: string; table: Table }>();

function referenceTargetTable(name: string, entity: EntityDefinition): Table {
  const cached = referenceTargetTables.get(entity);
  if (cached?.name === name) return cached.table;
  const table = buildEntityTable(name, entity);
  referenceTargetTables.set(entity, { name, table });
  return table;
}

export type ListSearchRequest = {
  readonly searchTerm: string;
  readonly searchAdapter: SearchAdapter | undefined;
  readonly entityName: string;
  readonly table: Table;
  readonly referenceSearch: ReferenceSearchOption;
  readonly fieldReadClause: (field: string) => OwnershipClause;
  readonly streamTenantFor: (user: SessionUser) => TenantId;
  readonly user: SessionUser;
  readonly db: TenantDb;
};

export type ListSearchOutcome =
  | { readonly kind: "noMatches" }
  | { readonly kind: "applied"; readonly searchTruncated: boolean };

export async function applyListSearch(
  request: ListSearchRequest,
  where: ListWhere,
): Promise<ListSearchOutcome> {
  const { searchAdapter } = request;
  // A search term with no adapter wired must fail loud, not
  // silently return the unfiltered list dressed up as a search result.
  if (!searchAdapter) {
    throw new UnprocessableError("search_adapter_not_wired", {
      details: {
        entity: request.entityName,
        hint: "Wire a SearchAdapter for this entity, or remove `searchable` from the field/screen.",
      },
    });
  }
  // Same choke-point as writes/index: systemStream docs live under
  // SYSTEM_TENANT_ID; everything else under the session tenant — db.mode
  // must not invent a second predicate.
  const searchTenantId = request.streamTenantFor(request.user);
  const results = await searchAdapter.search(searchTenantId, request.searchTerm, {
    filterType: request.entityName,
    limit: MAX_SEARCH_CANDIDATE_IDS,
  });
  const filterIds = results.map((r) => r.entityId);
  const referenceMatches = await resolveSearchableReferenceMatches(request, searchAdapter);
  if (filterIds.length === 0 && referenceMatches.length === 0) return { kind: "noMatches" };

  const orParts: string[] = [];
  if (filterIds.length > 0) {
    orParts.push(`${where.colSql("id")} IN (${bindPlaceholders(where.params, filterIds)})`);
  }
  for (const match of referenceMatches) {
    orParts.push(
      `${where.colSql(match.ownColumn)} IN (${bindPlaceholders(where.params, match.ids)})`,
    );
  }
  // Parenthesized as one whereSql entry — whereSql is joined with
  // " AND " below, an unparenthesized OR here would leak past the
  // tenant filter that follows.
  where.whereSql.push(`(${orParts.join(" OR ")})`);
  return { kind: "applied", searchTruncated: results.length >= MAX_SEARCH_CANDIDATE_IDS };
}

// A searchable reference field (or the implicit tenantId→tenant.name row-meta
// reference) whose target row's labelField matches the search term also counts
// as a hit on this entity, not just a raw text-field hit.
async function resolveSearchableReferenceMatches(
  request: ListSearchRequest,
  searchAdapter: SearchAdapter,
): Promise<readonly ReferenceMatch[]> {
  const { referenceSearch } = request;
  if (!referenceSearch) return [];
  // A caller who cannot read the reference column itself must not be able
  // to infer its value by matching the target's label — same probe
  // surface as filtering/sorting on it directly.
  const descriptors = collectReferenceSearchDescriptors(
    request.table,
    referenceSearch,
    request.db.mode,
  ).filter((d) => request.fieldReadClause(d.ownColumn).kind === "pass");
  const matches = await Promise.all(
    descriptors.map((d) =>
      resolveReferenceMatches(
        d,
        request.searchTerm,
        referenceSearch.resolveEntity,
        request.db,
        request.user,
        searchAdapter,
      ),
    ),
  );
  return matches.filter((m): m is ReferenceMatch => m !== undefined);
}

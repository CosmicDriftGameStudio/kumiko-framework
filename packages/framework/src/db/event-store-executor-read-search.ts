import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { escapeLikePattern } from "../crypto/ciphertext-pattern.ts";
import {
  buildOwnershipClause,
  normalizeAccessEntry,
  type OwnershipClause,
  shiftParams,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";

import { UnprocessableError } from "../errors/index.ts";
import type { SearchAdapter } from "../search/types.ts";
import { LIST_ROW_META_REFERENCES } from "../ui-types/list-row-meta.ts";
import { hasSearchablePlaintext, isSensitiveLabelField } from "./entity-field-encryption.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { Table } from "./event-store-executor-context.ts";
import { bindPlaceholders, type ListWhere } from "./event-store-executor-read-filter.ts";
import { referenceTargetTable } from "./parent-ownership.ts";
import type { ParentVisibilityOption } from "./parent-ref-clause.ts";

export { referenceTargetTable } from "./parent-ownership.ts";

import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { resolveReadOwnership } from "./read-ownership.ts";
import { quoteIdent } from "./sql-identifier.ts";
import { physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb, TenantDbMode } from "./tenant-db.ts";
import { tenantDbRunnerForTable } from "./tenant-db-runner.ts";

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

// The target of a reference is gated like a direct read of it (access rule, parent-ref and
// readGate): a label of a row the viewer cannot open must not be findable by searching or
// readable by ordering.
export function referenceTargetOwnership(
  targetEntity: EntityDefinition,
  targetTable: Table,
  targetTableName: string,
  user: SessionUser,
  db: TenantDb,
  parentVisibility: ParentVisibilityOption | undefined,
): OwnershipClause {
  return resolveReadOwnership(
    { entity: targetEntity, table: targetTable },
    targetTableName,
    user,
    db,
    parentVisibility,
    { includeDeleted: false, narrowTypes: undefined },
  );
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
// Mirrors the main table's tenant filter in appendTenantAndSoftDeleteScope
// (event-store-executor-read-where.ts) — keep in lock-step.
async function resolveReferenceMatchesViaIlike(
  descriptor: ReferenceSearchDescriptor,
  searchTerm: string,
  targetEntity: EntityDefinition,
  targetTable: Table,
  targetTableName: string,
  user: SessionUser,
  db: TenantDb,
  parentVisibility: ParentVisibilityOption | undefined,
): Promise<ReferenceMatch | undefined> {
  // The label must not leak through match counts: a viewer who cannot read the
  // target row or its label field would otherwise probe names by searching.
  const labelAccess = buildOwnershipClause(
    user,
    normalizeAccessEntry(targetEntity.fields[descriptor.labelField]?.access?.read),
    targetTable,
  );
  if (labelAccess.kind !== "pass") return undefined;
  const ownership = referenceTargetOwnership(
    targetEntity,
    targetTable,
    targetTableName,
    user,
    db,
    parentVisibility,
  );
  if (ownership.kind === "empty") return undefined;

  const labelCol = physicalColumnName(targetTable, descriptor.labelField);
  const subParams: unknown[] = [`%${escapeLikePattern(searchTerm)}%`];
  let tenantClause = "";
  if (targetTable["tenantId"] !== undefined && db.mode === "tenant") {
    subParams.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantClause = ` AND ${quoteIdent(physicalColumnName(targetTable, "tenantId"))} IN ($2, $3)`;
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
    ? ` AND ${quoteIdent(physicalColumnName(targetTable, "isDeleted"))} = FALSE`
    : "";
  // ::text cast covers a non-text labelField (e.g. a number/select column
  // used as label) — Postgres has no ILIKE for those types otherwise.
  const sql =
    `SELECT "id" FROM ${quoteIdent(targetTableName)} WHERE (${quoteIdent(labelCol)})::text ILIKE $1${tenantClause}${ownershipClause}${deletedClause} ` +
    `LIMIT ${MAX_REFERENCE_SEARCH_IDS + 1}`;
  const rows = await executeRawQueryRead<{ id: string }>(
    tenantDbRunnerForTable(db, targetTable),
    sql,
    subParams,
  );
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
  parentVisibility: ParentVisibilityOption | undefined,
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

  const ownership = referenceTargetOwnership(
    targetEntity,
    targetTable,
    targetTableName,
    user,
    db,
    parentVisibility,
  );
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
    tenantClause = ` AND ${quoteIdent(physicalColumnName(targetTable, "tenantId"))} IN ($${params.length - 1}, $${params.length})`;
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
    `SELECT "id" FROM ${quoteIdent(targetTableName)} WHERE "id" IN (${idPlaceholders.join(", ")})` +
    `${tenantClause}${ownershipClause}`;
  const rows = await executeRawQueryRead<{ id: string }>(
    tenantDbRunnerForTable(db, targetTable),
    sql,
    params,
  );
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
  resolveTable: ((entityName: string) => Table) | undefined,
  parentVisibility: ParentVisibilityOption | undefined,
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

  const targetTable =
    resolveTable?.(descriptor.targetEntityName) ??
    referenceTargetTable(descriptor.targetEntityName, targetEntity);
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
      parentVisibility,
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
    parentVisibility,
  );
}

export type ListSearchRequest = {
  readonly searchTerm: string;
  readonly searchAdapter: SearchAdapter | undefined;
  readonly entityName: string;
  readonly table: Table;
  readonly referenceSearch: ReferenceSearchOption;
  readonly parentVisibility: ParentVisibilityOption | undefined;
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
  const childSearch = await resolveChildSearchMatches(request, searchAdapter);
  const referenceMatches = [
    ...(await resolveSearchableReferenceMatches(request, searchAdapter)),
    ...childSearch.matches,
  ];
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
  return {
    kind: "applied",
    searchTruncated: results.length >= MAX_SEARCH_CANDIDATE_IDS || childSearch.truncated,
  };
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
        referenceSearch.resolveTable,
        request.parentVisibility,
      ),
    ),
  );
  return matches.filter((m): m is ReferenceMatch => m !== undefined);
}

type ChildRelationSearch = NonNullable<
  NonNullable<ReferenceSearchOption>["childRelations"]
>[number];

function areChildSearchFieldsReadable(
  relation: ChildRelationSearch,
  child: EntityDefinition,
  childTable: Table,
  user: SessionUser,
): boolean {
  return relation.searchableFields.every((searchableField) => {
    // Embedded entries are named "parent_sub"; the access lives on the parent field.
    const fieldName =
      searchableField in child.fields ? searchableField : searchableField.split("_")[0];
    const field = fieldName === undefined ? undefined : child.fields[fieldName];
    if (field === undefined) return false;
    return (
      buildOwnershipClause(user, normalizeAccessEntry(field.access?.read), childTable).kind ===
      "pass"
    );
  });
}

async function queryChildParentIds(
  relation: ChildRelationSearch,
  child: EntityDefinition,
  childTable: Table,
  childTableName: string,
  db: TenantDb,
  candidateIds: readonly string[],
  ownership: Exclude<OwnershipClause, { kind: "empty" }>,
): Promise<readonly { parentId: string | null }[]> {
  const params: unknown[] = [...candidateIds];
  const idPlaceholders = params.map((_, i) => `$${i + 1}`);
  let tenantClause = "";
  if (childTable["tenantId"] !== undefined && db.mode === "tenant") {
    params.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantClause = ` AND ${quoteIdent(physicalColumnName(childTable, "tenantId"))} IN ($${params.length - 1}, $${params.length})`;
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
  const deletedClause = isSoftDeletedTargetHidden(child, childTable)
    ? ` AND ${quoteIdent(physicalColumnName(childTable, "isDeleted"))} = FALSE`
    : "";
  const fkColumn = quoteIdent(physicalColumnName(childTable, relation.foreignKey));
  return executeRawQueryRead<{ parentId: string | null }>(
    tenantDbRunnerForTable(db, childTable),
    `SELECT DISTINCT ${fkColumn} AS "parentId" FROM ${quoteIdent(childTableName)} ` +
      `WHERE "id" IN (${idPlaceholders.join(", ")})${tenantClause}${ownershipClause}${deletedClause}`,
    params,
  );
}

// A parent matches when a child row matches the term, but only through a child entity whose detail
// handler admits the viewer, a child row they could open, and searchable fields they may all read;
// otherwise searching would probe values they cannot see. The index only names candidates; tenant
// scope, soft delete and ownership are re-checked against the child table.
async function resolveChildMatches(
  relation: ChildRelationSearch,
  request: ListSearchRequest,
  searchAdapter: SearchAdapter,
): Promise<{ readonly match: ReferenceMatch | undefined; readonly truncated: boolean }> {
  const none = { match: undefined, truncated: false };
  const { referenceSearch, user, db } = request;
  const child = referenceSearch?.resolveEntity(relation.childEntityName);
  if (child === undefined || relation.searchableFields.length === 0) return none;
  if (request.parentVisibility?.canReadEntity?.(relation.childEntityName) !== true) return none;
  const childTable =
    referenceSearch?.resolveTable?.(relation.childEntityName) ??
    referenceTargetTable(relation.childEntityName, child);
  const allFieldsReadable = areChildSearchFieldsReadable(relation, child, childTable, user);
  if (!allFieldsReadable) return none;

  const childTableName = String(schemaTableName(childTable));
  const ownership = referenceTargetOwnership(
    child,
    childTable,
    childTableName,
    user,
    db,
    request.parentVisibility,
  );
  if (ownership.kind === "empty") return none;

  const results = await searchAdapter.search(
    child.systemStream ? SYSTEM_TENANT_ID : user.tenantId,
    request.searchTerm,
    { filterType: relation.childEntityName, limit: MAX_SEARCH_CANDIDATE_IDS },
  );
  if (results.length === 0) return none;
  const truncated = results.length >= MAX_SEARCH_CANDIDATE_IDS;

  const rows = await queryChildParentIds(
    relation,
    child,
    childTable,
    childTableName,
    db,
    results.map((r) => String(r.entityId)),
    ownership,
  );
  const ids = rows.flatMap((row) => (row.parentId === null ? [] : [String(row.parentId)]));
  return { match: ids.length === 0 ? undefined : { ownColumn: "id", ids }, truncated };
}

async function resolveChildSearchMatches(
  request: ListSearchRequest,
  searchAdapter: SearchAdapter,
): Promise<{ readonly matches: readonly ReferenceMatch[]; readonly truncated: boolean }> {
  const relations = request.referenceSearch?.childRelations ?? [];
  const outcomes = await Promise.all(
    relations.map((relation) => resolveChildMatches(relation, request, searchAdapter)),
  );
  return {
    matches: outcomes.flatMap((o) => (o.match === undefined ? [] : [o.match])),
    truncated: outcomes.some((o) => o.truncated),
  };
}

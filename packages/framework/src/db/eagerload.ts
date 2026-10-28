// Server-side eagerload for reference fields.
//
// After `executor.list`/`detail` we scan the returned rows for reference
// values, collect the UUIDs per reference (deduped), run one
// WHERE id IN (...) lookup per referenced entity, and attach the resolved rows
// as `_refs.<fieldName>` (single) or `_refs.<fieldName>: Row[]` (multiple).
//
// Access scope: `_refs` only returns what the viewer could read on the target
// entity itself (tenant, access.read, parentRef gate, field-level read). An
// unreadable ref is absent exactly like a missing one, so there is no
// existence oracle; the renderer falls back to the UUID. The target detail
// handler's handler-level `access` is not evaluated (same as reference
// search/sort).
//
// No explicit limit on the lookup SELECT: it asks for exactly the UUIDs present
// in the main rows, so it is O(n) per page.
//
// Custom handlers must pass the viewer explicitly so the parentRef gate is
// never skipped silently.

import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { requestContext } from "../api/request-context.ts";
import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "../crypto/index.ts";
import { selectMany } from "../db/query.ts";
import { filterReadFields } from "../engine/field-access.ts";
import {
  buildOwnershipClause,
  combineClauses,
  shiftParams,
  tableNameOf,
} from "../engine/ownership.ts";
import { parseRefTargetEntityName } from "../engine/parse-ref-target.ts";
import { isUuid, SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { ReferenceFieldDef, SessionUser } from "../engine/types/index.ts";

import { scrubLogValue } from "../logging/scrub.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  resolveEntityFieldEncryption,
} from "./entity-field-encryption.ts";
import { buildParentRefClause, type ParentVisibilityOption } from "./parent-ref-clause.ts";
import { toPostgresArrayLiteral } from "./queries/postgres-array-literal.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { buildEntityTable, physicalColumnName } from "./table-builder.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

const log = createFallbackLogger("eagerload");

// Minimal registry lookup contract: one EntityDefinition per entity name.
// We do not import the full registry type because that would create a
// circular import between db/ and engine/. The caller (entity-handlers.ts)
// has ctx.registry and passes a closure here.
export type EagerLoadEntityResolver = (entityName: string) => EntityDefinition | undefined;

// Central typed row shape with _refs. `_refs` is server-side eagerload output:
// each reference field contains the resolved row (single) or an array of
// resolved rows (multiple). A reference column with value=null has
// _refs[fieldName]=undefined.
//
// Renderer/cell code reads `row._refs?.[fieldName]` instead of using an
// inline cast; server code adds `_refs` through enrichWithReferences. The
// type is structural, so apps that set their own refs (custom handlers)
// should reuse it.
export type EagerloadedRow<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  readonly _refs?: Readonly<
    Record<string, Record<string, unknown> | ReadonlyArray<Record<string, unknown>> | undefined>
  >;
};

type ReferenceFieldEntry = {
  readonly fieldName: string;
  readonly refEntityName: string;
  readonly multiple: boolean;
};

function isReferenceField(field: FieldDefinition): field is ReferenceFieldDef {
  return field.type === "reference";
}

export function collectReferenceFields(entity: EntityDefinition): readonly ReferenceFieldEntry[] {
  const out: ReferenceFieldEntry[] = [];
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isReferenceField(fieldDef)) continue;
    out.push({
      fieldName,
      refEntityName: parseRefTargetEntityName(fieldDef.entity),
      multiple: fieldDef.multiple === true,
    });
  }
  return out;
}

export type EagerLoadViewer = {
  readonly user: SessionUser;
  readonly parentVisibility: ParentVisibilityOption;
  // The table a referenced entity is read from; absent means the one its fields derive.
  readonly resolveTable?: (entityName: string) => ReturnType<typeof buildEntityTable>;
};

// Referenced rows are read via a raw selectMany, not the referenced entity's
// own executor context (that would need table/searchAdapter/entityCache wiring
// per ref). Access is enforced separately by readableRefIds. Mirrors
// event-store-executor-context's decryptForRead ordering: PII is the outer
// layer, peel it before the envelope-encrypted fields, or the envelope
// cipher chokes on a still-PII-wrapped string.
async function decryptReferencedRow(
  row: Record<string, unknown>,
  piiFields: readonly string[],
  encryptedFields: ReadonlySet<string>,
  kms: ReturnType<typeof configuredPiiSubjectKms>,
): Promise<Record<string, unknown>> {
  let out = row;
  if (piiFields.length > 0 && kms) {
    out = await decryptPiiFieldValues(out, piiFields, kms, {
      requestId: requestContext.get()?.requestId ?? "eagerload",
    });
  }
  if (encryptedFields.size > 0) {
    out = await decryptEntityFieldValues(out, encryptedFields, resolveEntityFieldEncryption());
  }
  return out;
}

type RefAccessScope =
  | { readonly kind: "none" }
  | { readonly kind: "unrestricted" }
  | { readonly kind: "restricted"; readonly readableIds: ReadonlySet<string> };

// One probe query per ref field: the ids the viewer may read on the target
// entity. Raw SQL because ownership/parentRef clauses are SQL fragments; the
// table is unaliased since where-rules qualify columns with the table name.
async function resolveRefAccessScope(
  refEntity: EntityDefinition,
  refTable: ReturnType<typeof buildEntityTable>,
  refTableName: string,
  ids: readonly string[],
  db: TenantDb,
  viewer: EagerLoadViewer,
): Promise<RefAccessScope> {
  const access = combineClauses(
    buildOwnershipClause(viewer.user, refEntity.access?.read, refTable),
    buildParentRefClause(
      refEntity,
      refTable,
      refTableName,
      viewer.user,
      db,
      viewer.parentVisibility,
      {
        includeDeleted: false,
      },
    ),
  );
  if (access.kind === "empty") return { kind: "none" };
  if (access.kind === "pass") return { kind: "unrestricted" };
  // No read path exists for non-uuid ids, so nothing can be access-checked.
  if (refEntity.idType !== undefined && refEntity.idType !== "uuid") return { kind: "none" };

  const params: unknown[] = [toPostgresArrayLiteral(ids)];
  let tenantClause = "";
  if (refTable["tenantId"] !== undefined && db.mode === "tenant") {
    params.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantClause = ` AND "${physicalColumnName(refTable, "tenantId")}" IN ($2, $3)`;
  }
  const shifted = shiftParams({ sqlText: access.sqlText, params: access.params }, params.length);
  params.push(...shifted.params);
  const rows = await executeRawQueryRead<{ id: string }>(
    tenantDbRunner(db),
    `SELECT "id" FROM "${refTableName}" WHERE "id" = ANY($1::uuid[])${tenantClause} AND ${shifted.sqlText}`,
    params,
  );
  return { kind: "restricted", readableIds: new Set(rows.map((r) => r.id)) };
}

// Per-row, not Promise.all: a single legacy/backfilled row without a valid
// envelope (decryptEntityFieldValues throws hard on malformed ciphertext)
// must not 500 the whole list request — the main rows the caller asked for
// are unrelated to this one broken reference. Drop just that row from the
// map; the renderer falls back to the raw UUID.
//
// piiFields/encryptedFields/kms are constant per refEntity — the
// caller computes them once and passes them in instead of recomputing per row.
async function buildRefLookupMap(
  rawRefRows: ReadonlyArray<Record<string, unknown>>,
  refEntity: EntityDefinition,
  refEntityName: string,
  viewer: EagerLoadViewer,
  piiFields: readonly string[],
  encryptedFields: ReadonlySet<string>,
  kms: ReturnType<typeof configuredPiiSubjectKms>,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rawRefRows) {
    let decrypted: Record<string, unknown>;
    try {
      decrypted = await decryptReferencedRow(r, piiFields, encryptedFields, kms);
    } catch (e) {
      log.warn("failed to decrypt referenced row", {
        entity: refEntityName,
        id: String(r["id"]),
        err: scrubLogValue(e),
      });
      continue;
    }
    const id = decrypted["id"];
    if (typeof id === "string") map.set(id, filterReadFields(refEntity, decrypted, viewer.user));
  }
  return map;
}

function collectRefIds(
  rows: ReadonlyArray<Record<string, unknown>>,
  rf: ReferenceFieldEntry,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const v = row[rf.fieldName];
    const values = rf.multiple ? (Array.isArray(v) ? v : []) : [v];
    for (const item of values) {
      if (typeof item === "string" && item.length > 0) ids.add(item);
    }
  }
  return ids;
}

/** Eagerloads a list of rows without mutating them; returns shallow copies
 *  with an added `_refs` property. */
export async function enrichWithReferences(
  rows: ReadonlyArray<Record<string, unknown>>,
  entity: EntityDefinition,
  resolveEntity: EagerLoadEntityResolver,
  db: TenantDb,
  viewer: EagerLoadViewer,
): Promise<Array<Record<string, unknown>>> {
  const refFields = collectReferenceFields(entity);
  if (refFields.length === 0 || rows.length === 0) {
    return rows.map((r) => ({ ...r }));
  }

  // For each reference field, collect IDs in a deduplicated Set, then run one
  // SELECT WHERE id IN (...). Build the maps in parallel so the lookups do
  // not run serially (Promise.all).
  const lookupMaps = await Promise.all(
    refFields.map(async (rf) => {
      const ids = collectRefIds(rows, rf);
      if (ids.size === 0) return { fieldName: rf.fieldName, multiple: rf.multiple, map: new Map() };
      const refEntity = resolveEntity(rf.refEntityName);
      if (refEntity === undefined) {
        // Authoring error or race condition (the entity was renamed without a
        // registry reload). The boot validator normally catches this;
        // as a runtime safeguard, an empty map makes the renderer fall back
        // to the UUID instead of crashing.
        return { fieldName: rf.fieldName, multiple: rf.multiple, map: new Map() };
      }
      const refTable =
        viewer.resolveTable?.(rf.refEntityName) ?? buildEntityTable(rf.refEntityName, refEntity);
      const refTableName = tableNameOf(refTable);
      const usesUuidIds = refEntity.idType === undefined || refEntity.idType === "uuid";
      // A malformed ref value must not 500 the whole list via the uuid cast.
      const idArray = usesUuidIds ? [...ids].filter(isUuid) : [...ids];
      const emptyLookup = { fieldName: rf.fieldName, multiple: rf.multiple, map: new Map() };
      if (idArray.length === 0) return emptyLookup;
      const scope = await resolveRefAccessScope(
        refEntity,
        refTable,
        refTableName,
        idArray,
        db,
        viewer,
      );
      if (scope.kind === "none") return emptyLookup;
      const lookedUpRows = await selectMany<Record<string, unknown>>(db, refTable, {
        id: idArray,
      });
      const rawRefRows =
        scope.kind === "restricted"
          ? lookedUpRows.filter((r) => scope.readableIds.has(String(r["id"])))
          : lookedUpRows;
      const piiFields = collectPiiSubjectFields(refEntity);
      const encryptedFields = collectEncryptedFieldNames(refEntity);
      const kms = configuredPiiSubjectKms();
      const map = await buildRefLookupMap(
        rawRefRows,
        refEntity,
        rf.refEntityName,
        viewer,
        piiFields,
        encryptedFields,
        kms,
      );
      return { fieldName: rf.fieldName, multiple: rf.multiple, map };
    }),
  );

  return rows.map((row) => {
    const refs: Record<string, unknown> = {};
    for (const lookup of lookupMaps) {
      const v = row[lookup.fieldName];
      if (lookup.multiple) {
        const ids = Array.isArray(v) ? v : [];
        const resolved = ids
          .map((id) => (typeof id === "string" ? lookup.map.get(id) : undefined))
          .filter((r) => r !== undefined);
        refs[lookup.fieldName] = resolved;
      } else if (typeof v === "string" && v.length > 0) {
        refs[lookup.fieldName] = lookup.map.get(v);
      } else {
        refs[lookup.fieldName] = undefined;
      }
    }
    return { ...row, _refs: refs };
  });
}

/** Single-row variant for detail calls. */
export async function enrichRowWithReferences(
  row: Record<string, unknown>,
  entity: EntityDefinition,
  resolveEntity: EagerLoadEntityResolver,
  db: TenantDb,
  viewer: EagerLoadViewer,
): Promise<Record<string, unknown>> {
  const enriched = await enrichWithReferences([row], entity, resolveEntity, db, viewer);
  return enriched[0] ?? { ...row, _refs: {} };
}

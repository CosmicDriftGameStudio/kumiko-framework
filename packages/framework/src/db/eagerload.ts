// Tier 2.7e Server-Side Eagerload für Reference-Felder.
//
// Nach `executor.list`/`detail` scannen wir die zurückgelieferten
// rows nach reference-Field-Values, sammeln pro Reference die UUIDs
// (deduped), führen einen einzigen WHERE id IN (...)-Lookup pro
// Referenced-Entity aus, und hängen die resolved Rows als
// `_refs.<fieldName>` (single) bzw. `_refs.<fieldName>: Row[]`
// (multiple) an die Original-Rows.
//
// Tenant-Scope: TenantDb hat den Tenant-Filter eingebaut (mode:
// "tenant"); der Lookup erbt das transparent. Cross-Feature-Refs
// landen automatisch im selben Tenant — falls ein referenced Item
// dem User nicht gehört, kommt es aus dem Lookup nicht zurück
// (TenantDb filtert), und der Renderer fällt auf UUID zurück.
//
// Limit: kein expliziter limit auf den Lookup-SELECT — wir
// fragen genau die UUIDs ab die in den main-Rows vorkommen, also
// O(n) pro Page (bei pageSize:50 mit 2 ref-Spalten = max 100 IDs).
// Render-Side limit:200-Workaround entfällt damit komplett.
//
// Diese Datei lebt im framework/db damit sie an einer Stelle
// zwischen executor und entity-handlers gemounted ist; sie nutzt
// keine framework-engine-Internals und kann auch von custom
// query-handlern manuell aufgerufen werden.

import { requestContext } from "../api/request-context";
import { collectPiiSubjectFields, configuredPiiSubjectKms, decryptPiiFieldValues } from "../crypto";
import { selectMany } from "../db/query";
import type { EntityDefinition, FieldDefinition, ReferenceFieldDef } from "../engine/types";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  resolveEntityFieldEncryption,
} from "./entity-field-encryption";
import { buildEntityTable } from "./table-builder";
import type { TenantDb } from "./tenant-db";

// Minimaler Registry-Lookup-Contract: pro entity-name → EntityDefinition.
// Wir importieren NICHT den ganzen Registry-Type weil das einen
// circular import zwischen db/ und engine/ erzeugen würde — der
// Caller (entity-handlers.ts) hat ctx.registry und reicht hier eine
// Closure rein.
export type EagerLoadEntityResolver = (entityName: string) => EntityDefinition | undefined;

// Tier 2.7e Audit-Fix #6: zentral typed Row-Shape mit _refs. Der
// `_refs`-Property ist Server-Eagerload-Output: pro reference-Field
// die resolved Row (single) oder ein Array resolved Rows (multiple).
// Eine reference-Spalte mit value=null hat _refs[fieldName]=undefined.
//
// Renderer/Cell-Code liest `row._refs?.[fieldName]` statt inline-Cast;
// Server-Code stempelt `_refs` über enrichWithReferences. Type ist
// strukturell — auch Apps die ihre eigenen Refs setzen (Custom-
// Handler) sollten das hier wiederverwenden.
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

function parseRefEntity(raw: string): string {
  // Same-feature ("user") oder cross-feature ("users:user") — wir
  // brauchen nur den entity-name (Names sind global eindeutig in
  // entityMap). Der feature-prefix dient nur der Author-Klarheit.
  const idx = raw.indexOf(":");
  return idx < 0 ? raw : raw.slice(idx + 1);
}

export function collectReferenceFields(entity: EntityDefinition): readonly ReferenceFieldEntry[] {
  const out: ReferenceFieldEntry[] = [];
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isReferenceField(fieldDef)) continue;
    out.push({
      fieldName,
      refEntityName: parseRefEntity(fieldDef.entity),
      multiple: fieldDef.multiple === true,
    });
  }
  return out;
}

// Referenced rows are read via a raw selectMany, not the referenced entity's
// own executor context (enrichWithReferences only gets an
// EagerLoadEntityResolver — routing through buildExecutorContext per ref
// would need table/searchAdapter/entityCache wiring for no reason). Mirrors
// event-store-executor-context's decryptForRead ordering: PII is the outer
// layer, peel it before the envelope-encrypted fields, or the envelope
// cipher chokes on a still-PII-wrapped string.
//
// Ownership guard (fw#1671): the ref lookup below is tenant-scoped only, not
// ownership-scoped — this function has no SessionUser to evaluate
// refEntity.access.read against. If the ref entity declares row-level
// ownership at all, decrypting here would hand a same-tenant User A the
// plaintext PII of a User B row they merely reference (e.g. a freely-settable
// reference UUID), even though refEntity.access.read says "own" — the caller
// never gets to run that ownership check. Fail closed: strip PII/encrypted
// fields entirely instead of decrypting (or leaking ciphertext) when that
// guarantee can't be evaluated here.
function hasOwnershipScopedRead(refEntity: EntityDefinition): boolean {
  const readMap = refEntity.access?.read;
  if (readMap === undefined) return false;
  // "all" means that role sees every row unrestricted — a map where every
  // rule is "all" carries no ownership restriction at all, so stripping
  // here would just silently drop PII/encrypted fields #1667 wants
  // decrypted, for no security benefit.
  return Object.values(readMap).some((rule) => rule !== "all");
}

async function decryptReferencedRow(
  row: Record<string, unknown>,
  refEntity: EntityDefinition,
  piiFields: readonly string[],
  encryptedFields: ReadonlySet<string>,
  kms: ReturnType<typeof configuredPiiSubjectKms>,
): Promise<Record<string, unknown>> {
  if (hasOwnershipScopedRead(refEntity)) {
    if (piiFields.length === 0 && encryptedFields.size === 0) return row;
    const out = { ...row };
    for (const field of piiFields) delete out[field];
    for (const field of encryptedFields) delete out[field];
    return out;
  }

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

// Per-row, not Promise.all: a single legacy/backfilled row without a valid
// envelope (decryptEntityFieldValues throws hard on malformed ciphertext)
// must not 500 the whole list request — the main rows the caller asked for
// are unrelated to this one broken reference. Drop just that row from the
// map; the renderer falls back to the raw UUID.
//
// piiFields/encryptedFields/kms are constant per refEntity (fw#1671) — the
// caller computes them once and passes them in instead of recomputing per row.
async function buildRefLookupMap(
  rawRefRows: ReadonlyArray<Record<string, unknown>>,
  refEntity: EntityDefinition,
  refEntityName: string,
  piiFields: readonly string[],
  encryptedFields: ReadonlySet<string>,
  kms: ReturnType<typeof configuredPiiSubjectKms>,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rawRefRows) {
    let decrypted: Record<string, unknown>;
    try {
      decrypted = await decryptReferencedRow(r, refEntity, piiFields, encryptedFields, kms);
    } catch (e) {
      console.warn(
        `[eagerload] failed to decrypt referenced row entity=${refEntityName} id=${String(r["id"])}: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const id = decrypted["id"];
    if (typeof id === "string") map.set(id, decrypted);
  }
  return map;
}

/** Eagerload für eine Liste von Rows. Mutiert nicht — gibt eine
 *  flache Kopie der Rows mit hinzugefügtem `_refs`-Property zurück. */
export async function enrichWithReferences(
  rows: ReadonlyArray<Record<string, unknown>>,
  entity: EntityDefinition,
  resolveEntity: EagerLoadEntityResolver,
  db: TenantDb,
): Promise<Array<Record<string, unknown>>> {
  const refFields = collectReferenceFields(entity);
  if (refFields.length === 0 || rows.length === 0) {
    return rows.map((r) => ({ ...r }));
  }

  // Pro reference-Field: deduped Set der IDs sammeln, dann ein
  // einziger SELECT WHERE id IN (...). Maps werden parallel gebaut
  // damit die Lookups nicht serialisieren (Promise.all).
  const lookupMaps = await Promise.all(
    refFields.map(async (rf) => {
      const ids = new Set<string>();
      for (const row of rows) {
        const v = row[rf.fieldName];
        if (rf.multiple) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item === "string" && item.length > 0) ids.add(item);
            }
          }
        } else if (typeof v === "string" && v.length > 0) {
          ids.add(v);
        }
      }
      if (ids.size === 0) return { fieldName: rf.fieldName, multiple: rf.multiple, map: new Map() };
      const refEntity = resolveEntity(rf.refEntityName);
      if (refEntity === undefined) {
        // Author-Fehler oder Race-Condition (entity gerade umbenannt
        // ohne registry-Reload). Boot-Validator hat das normalerweise
        // gepinnt; Runtime-Defense: leere Map → Renderer fällt auf
        // UUID zurück, kein Crash.
        return { fieldName: rf.fieldName, multiple: rf.multiple, map: new Map() };
      }
      const refTable = buildEntityTable(rf.refEntityName, refEntity);
      const idArray = [...ids];
      const rawRefRows = (await selectMany(db, refTable, { id: idArray })) as Array<
        Record<string, unknown>
      >;
      const piiFields = collectPiiSubjectFields(refEntity);
      const encryptedFields = collectEncryptedFieldNames(refEntity);
      const kms = configuredPiiSubjectKms();
      const map = await buildRefLookupMap(
        rawRefRows,
        refEntity,
        rf.refEntityName,
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

/** Single-Row-Variante für detail-Calls. */
export async function enrichRowWithReferences(
  row: Record<string, unknown>,
  entity: EntityDefinition,
  resolveEntity: EagerLoadEntityResolver,
  db: TenantDb,
): Promise<Record<string, unknown>> {
  const enriched = await enrichWithReferences([row], entity, resolveEntity, db);
  return enriched[0] ?? { ...row, _refs: {} };
}

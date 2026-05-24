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

import { selectMany } from "../db/query";
import type { EntityDefinition, FieldDefinition, ReferenceFieldDef } from "../engine/types";
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
      const refRows = (await selectMany(db, refTable, { id: idArray })) as Array<
        Record<string, unknown>
      >;
      const map = new Map<string, Record<string, unknown>>();
      for (const r of refRows) {
        const id = r["id"];
        if (typeof id === "string") map.set(id, r);
      }
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

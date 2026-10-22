import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { computeBlindIndex, configuredBlindIndexKey } from "../crypto/index.ts";
import { type OwnershipClause, shiftParams } from "../engine/ownership.ts";
import type { EntityDefinition } from "../engine/types/index.ts";
import { ValidationError } from "../errors/index.ts";
import { isListFilterAllowed } from "./entity-field-encryption.ts";
import { buildFilterWhere, type Table } from "./event-store-executor-context.ts";

// Raw-SQL WHERE under construction: fragments are AND-joined and bound against
// one positional params list, so every step appends in statement order.
export type ListWhere = {
  readonly whereSql: string[];
  readonly params: unknown[];
  readonly colSql: (field: string) => string;
};

export function appendShiftedClause(
  where: ListWhere,
  clause: { readonly sqlText: string; readonly params: readonly unknown[] },
): void {
  const shifted = shiftParams(
    { sqlText: clause.sqlText, params: clause.params },
    where.params.length,
  );
  where.whereSql.push(shifted.sqlText);
  for (const p of shifted.params) where.params.push(p);
}

export function bindPlaceholders(params: unknown[], values: readonly unknown[]): string {
  return values
    .map((value) => {
      params.push(value);
      return `$${params.length}`;
    })
    .join(", ");
}

export type ListFilter = {
  readonly field: string;
  readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
  readonly value: unknown;
};

// multiSelect stores its options as a jsonb array — a filter value is one
// option, not the whole array, so eq/ne/in must check array containment
// (`@>`) instead of scalar `=`/`<>`/`IN` against the jsonb column.
// lt/gt/lte/gte have no containment analogue; the boot-validator already
// blocks them for screen-declared filters (screen-filter-ops.ts
// EQUALITY_ONLY), but a client-supplied facet filter reaches here
// unvalidated, so treat it as unsatisfiable rather than emitting SQL
// Postgres would reject.
function applyMultiSelectFilter(
  colSql: (field: string) => string,
  whereSql: string[],
  params: unknown[],
  f: ListFilter,
): void {
  if (f.op === "lt" || f.op === "gt" || f.op === "lte" || f.op === "gte") {
    whereSql.push("FALSE");
    // skip: lt/gt/lte/gte is unsatisfiable on a multiSelect column
    return;
  }
  if (f.op === "in") {
    if (!Array.isArray(f.value) || f.value.length === 0) {
      whereSql.push("FALSE");
      // skip: empty/non-array `in` is unsatisfiable, mirrors buildFilterWhere's "in" short-circuit
      return;
    }
    const parts = f.value.map((v) => {
      params.push(JSON.stringify([v]));
      return `${colSql(f.field)} @> $${params.length}::text::jsonb`;
    });
    whereSql.push(`(${parts.join(" OR ")})`);
    // skip: containment condition already pushed — don't fall through to the eq/ne branch below
    return;
  }
  const candidates = Array.isArray(f.value) ? f.value : [f.value];
  // `@> '[]'` is true for every non-null row, so an empty array would turn
  // the filter into a silent match-all.
  if (candidates.length === 0) {
    whereSql.push("FALSE");
    // skip: empty candidate list is unsatisfiable
    return;
  }
  // Bound as text then cast: a JS array makes postgres.js infer boolean[]/int4[]
  // for client-supplied non-string values, and `boolean[]::jsonb` is rejected
  // (500 on client input). An array value means "contains all of these".
  params.push(JSON.stringify(candidates));
  const containment = `${colSql(f.field)} @> $${params.length}::text::jsonb`;
  // A NULL column must count as "does not contain" — plain NOT(...) yields
  // NULL and would drop those rows.
  whereSql.push(
    f.op === "ne" ? `(${colSql(f.field)} IS NULL OR NOT (${containment}))` : containment,
  );
}

// Falls through to the screen-filter WHERE builder shared with
// screen-declared filters — buildFilterWhere flattens the op into a
// WhereObject, which this then lowers to raw SQL fragments.
function applyScreenFilter(
  table: Table,
  colSql: (field: string) => string,
  whereSql: string[],
  params: unknown[],
  f: ListFilter,
): void {
  const screen = buildFilterWhere(f.field, f.op, f.value);
  if (screen === null) {
    whereSql.push("FALSE");
    // skip: filter is unsatisfiable → emit FALSE, no params to bind
    return;
  }
  for (const [field, value] of Object.entries(screen)) {
    // `x <> NULL` is never true — mirror buildWhereClause's IS [NOT] NULL handling in db/where-clause.ts.
    if (value === null) {
      whereSql.push(`${colSql(field)} IS NULL`);
    } else if (Array.isArray(value)) {
      const placeholders = value.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      whereSql.push(`${colSql(field)} IN (${placeholders.join(", ")})`);
    } else if (isPlainObject(value)) {
      if (value["ne"] === null && Object.keys(value).length === 1) {
        whereSql.push(`${colSql(field)} IS NOT NULL`);
        continue;
      }
      const opMap: Record<string, string> = {
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
        ne: "<>",
      };
      for (const [opKey, opSym] of Object.entries(opMap)) {
        if (!(opKey in value)) continue;
        params.push(value[opKey]);
        whereSql.push(`${colSql(field)} ${opSym} $${params.length}`);
      }
    } else {
      // Blind-index OR rewrite, lock-step with buildWhereClause
      // in db/where-clause.ts — equality on lookupable fields matches the
      // plaintext arm OR the HMAC arm.
      const bidxKey = configuredBlindIndexKey();
      if (bidxKey !== undefined && typeof value === "string" && table[`${field}Bidx`]) {
        params.push(value, computeBlindIndex(bidxKey, value));
        whereSql.push(
          `(${colSql(field)} = $${params.length - 1} OR ${colSql(`${field}Bidx`)} = $${params.length})`,
        );
      } else {
        params.push(value);
        whereSql.push(`${colSql(field)} = $${params.length}`);
      }
    }
  }
}

// A `filter`/`filters` entry that already pins the parentRef's entityType
// field is a real subset of the parent-ref clause's own OR-branches — the
// client-supplied filter can't widen the result, only narrow which branches
// the SQL even needs to consider. Skipped for multiSelect fields, where `eq`
// means containment (see applyMultiSelectFilter) rather than equality.
export function deriveParentNarrowTypes(
  entity: EntityDefinition,
  payload: { readonly filter?: ListFilter; readonly filters?: readonly ListFilter[] },
): ReadonlySet<string> | undefined {
  const parentRef = entity.parentRef;
  if (parentRef === undefined) return undefined;
  if (entity.fields[parentRef.entityTypeField]?.type === "multiSelect") return undefined;

  const typeFilters = [
    ...(payload.filter ? [payload.filter] : []),
    ...(payload.filters ?? []),
  ].filter((f) => f.field === parentRef.entityTypeField);

  let narrowed: Set<string> | undefined;
  for (const f of typeFilters) {
    let values: readonly string[] | undefined;
    if (f.op === "eq" && typeof f.value === "string") {
      values = [f.value];
    } else if (
      f.op === "in" &&
      Array.isArray(f.value) &&
      f.value.every((v) => typeof v === "string")
    ) {
      values = f.value;
    }
    if (values === undefined) continue;
    narrowed =
      narrowed === undefined
        ? new Set(values)
        : new Set([...narrowed].filter((v) => values.includes(v)));
  }
  return narrowed;
}

export function collectListFilters(payload: {
  readonly filter?: ListFilter | undefined;
  readonly filters?: readonly ListFilter[] | undefined;
}): readonly ListFilter[] {
  const single = payload.filter !== undefined ? [payload.filter] : [];
  return payload.filters !== undefined ? [...single, ...payload.filters] : single;
}

export function applyListFilter(
  where: ListWhere,
  f: ListFilter,
  table: Table,
  entity: EntityDefinition,
  fieldReadClause: (field: string) => OwnershipClause,
): void {
  if (table[f.field] === undefined) {
    // skip: unknown field — not a real column, drop the filter (injection guard)
    return;
  }
  const readClause = fieldReadClause(f.field);
  if (readClause.kind === "empty") {
    where.whereSql.push("FALSE");
    // skip: no role grants read on this field, so no row may be probed
    // through it — an unsatisfiable filter beats an error, which would
    // itself confirm the field exists (field-access.ts strips silently)
    return;
  }
  if (!isListFilterAllowed(entity, f.field, f)) {
    throw new ValidationError({
      fields: [
        {
          path: `filter.${f.field}`,
          code: "field_not_filterable",
          i18nKey: "errors.validation.invalid_value",
          params: {
            field: f.field,
            op: f.op,
            hint: "Encrypted, personal and secret fields cannot be filtered; only equality on a field with find: exact or fuzzy.",
          },
        },
      ],
    });
  }
  if (readClause.kind === "sql") appendShiftedClause(where, readClause);
  if (entity.fields[f.field]?.type === "multiSelect") {
    applyMultiSelectFilter(where.colSql, where.whereSql, where.params, f);
    // skip: multiSelect already handled — don't fall through to applyScreenFilter
    return;
  }
  applyScreenFilter(table, where.colSql, where.whereSql, where.params, f);
}

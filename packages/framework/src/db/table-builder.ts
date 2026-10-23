/// <reference types="temporal-polyfill/global" preserve="true" />
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import { KUMIKO_META_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import type {
  EntityDefinition,
  EntityRelations,
  FieldDefinition,
  FieldsMap,
} from "../engine/types/index.ts";
import { toSnakeCase } from "../utils/case.ts";
import type { Table } from "./event-store-executor-context.ts";
import { markExecutorManagedTable } from "./executor-managed-tables.ts";
import type { LocatedTimestampRead } from "./located-timestamp.ts";
import type { MoneyRead } from "./money.ts";
import { columnHandleName } from "./table-introspection.ts";

export { toSnakeCase } from "../utils/case.ts";

import {
  bigint,
  boolean,
  type ColumnBuilder,
  type ColumnHandle,
  decimalColumn,
  doublePrecision,
  type IndexBuilderWithCols,
  index,
  instant,
  integer,
  isSqlExpression,
  jsonb,
  moneyAmount,
  table as pgTable,
  plainDate,
  type SchemaTable,
  serial,
  sql,
  type TableColumns,
  text,
  uniqueIndex,
  uuid,
} from "./dialect.ts";

// Partial-index predicate for soft-delete entities; table-builder and
// entity-table-meta must render identical index definitions.
export const SOFT_DELETE_LIVE_ROW_PREDICATE = `"is_deleted" = false`;

// Shared by the CRUD executor and the parent-ref read-gate — a field's
// declared column name if it has one, else its snake_case default.
export function physicalColumnName(table: Table, field: string): string {
  return columnHandleName(table, field) ?? toSnakeCase(field);
}

// Local AnyPgColumn alias — kept for legacy field-definition callers that
// still import this name as a type. ColumnHandle from the native dialect
// matches the same role (snake_case name + sql type accessor).
export type AnyPgColumn = ColumnHandle;

// biome-ignore lint/suspicious/noExplicitAny: ColumnBuilder is parameterised over value type; we erase here
type AnyColumnBuilder = ColumnBuilder<any>;

type FieldType = FieldDefinition["type"];
type FieldOf<K extends FieldType> = Extract<FieldDefinition, { type: K }>;
type FieldColumns = Record<string, AnyColumnBuilder>;
type ColumnEmitter<K extends FieldType> = (
  name: string,
  snakeName: string,
  field: FieldOf<K>,
  entity: EntityDefinition,
) => FieldColumns;

// `required: true` maps to NOT NULL for every field type, so r.entity stays the
// single source of truth and hand-written tables never add .notNull() on top.
function notNullWhenRequired(
  column: AnyColumnBuilder,
  required: boolean | undefined,
): AnyColumnBuilder {
  return required ? column.notNull() : column;
}

// Without a DEFAULT clause ALTER TABLE ADD COLUMN breaks on existing rows, and
// entity-table-meta renders declared defaults too, so both builders stay in lockstep.
function withDeclaredDefault(
  column: AnyColumnBuilder,
  value: string | number | boolean | undefined,
): AnyColumnBuilder {
  return value !== undefined ? column.default(value) : column;
}

// longText differs from text only in the type layer (no sortable/searchable/filterable).
function textColumns(
  name: string,
  snakeName: string,
  field: FieldOf<"text" | "longText">,
): FieldColumns {
  const declaredDefault = "default" in field ? field.default : undefined;
  const mainCol = {
    [name]: notNullWhenRequired(
      withDeclaredDefault(text(snakeName), declaredDefault),
      field.required,
    ),
  };
  // Nullable HMAC blind-index column, in lockstep with fieldToColumnMeta in entity-table-meta.ts.
  if (field.type === "text" && field.lookupable === true) {
    return { ...mainCol, [`${name}Bidx`]: text(`${snakeName}_bidx`) };
  }
  return mainCol;
}

function booleanColumns(name: string, snakeName: string, field: FieldOf<"boolean">): FieldColumns {
  if (field.default !== undefined) {
    return { [name]: boolean(snakeName).default(field.default).notNull() };
  }
  return { [name]: notNullWhenRequired(boolean(snakeName), field.required) };
}

function numberColumns(name: string, snakeName: string, field: FieldOf<"number">): FieldColumns {
  const base = field.integer === true ? integer(snakeName) : doublePrecision(snakeName);
  return { [name]: notNullWhenRequired(withDeclaredDefault(base, field.default), field.required) };
}

function referenceColumns(
  name: string,
  snakeName: string,
  field: FieldOf<"reference">,
): FieldColumns {
  if (field.multiple === true) return { [name]: emptyJsonbArray(snakeName) };
  return { [name]: notNullWhenRequired(uuid(snakeName), field.required) };
}

// BIGINT minor units: INTEGER would cap at about 21 M EUR. The currency column
// always has a default, so it is structurally NOT NULL.
function moneyColumns(
  name: string,
  snakeName: string,
  field: FieldOf<"money">,
  entity: EntityDefinition,
): FieldColumns {
  return {
    [name]: notNullWhenRequired(moneyAmount(snakeName), field.required),
    [`${name}Currency`]: text(`${snakeName}_currency`)
      .default(entity.defaultCurrency ?? "EUR")
      .notNull(),
  };
}

// <name>_utc + <name>_tz form an atomic pair the executor converts on write and
// read, so `required` propagates to both columns.
function locatedTimestampColumns(
  name: string,
  snakeName: string,
  field: FieldOf<"locatedTimestamp">,
): FieldColumns {
  return {
    [`${name}Utc`]: notNullWhenRequired(instant(`${snakeName}_utc`), field.required),
    [`${name}Tz`]: notNullWhenRequired(text(`${snakeName}_tz`), field.required),
  };
}

// The `[]` default makes the column structurally never null, so `required` is
// intentionally ignored and read-side code needs no null check.
function emptyJsonbArray(snakeName: string): AnyColumnBuilder {
  return jsonb(snakeName).default([]).notNull();
}

// Same reasoning as emptyJsonbArray; optional embedded data needs a wrapper field.
function emptyJsonbObject(snakeName: string): AnyColumnBuilder {
  return jsonb(snakeName).default({}).notNull();
}

function singleColumnNotNullWhenRequired(
  column: (snakeName: string) => AnyColumnBuilder,
): (name: string, snakeName: string, field: { readonly required?: boolean }) => FieldColumns {
  return (name, snakeName, field) => ({
    [name]: notNullWhenRequired(column(snakeName), field.required),
  });
}

// Each entry has a type-level twin in ColumnsForField and a meta-level twin in
// fieldToColumnMeta (entity-table-meta.ts).
const COLUMN_EMITTERS: { readonly [K in FieldType]: ColumnEmitter<K> } = {
  text: textColumns,
  longText: textColumns,
  boolean: booleanColumns,
  select: (name, snakeName, field) => ({
    [name]: notNullWhenRequired(
      withDeclaredDefault(text(snakeName), field.default),
      field.required,
    ),
  }),
  multiSelect: (name, snakeName) => ({ [name]: emptyJsonbArray(snakeName) }),
  number: numberColumns,
  decimal: (name, snakeName, field) => ({
    [name]: notNullWhenRequired(
      withDeclaredDefault(decimalColumn(snakeName, field.precision, field.scale), field.default),
      field.required,
    ),
  }),
  // mode "number" keeps the value JSON-serializable (safe up to 2^53).
  bigInt: (name, snakeName, field) => ({
    [name]: notNullWhenRequired(
      withDeclaredDefault(bigint(snakeName, { mode: "number" }), field.default),
      field.required,
    ),
  }),
  reference: referenceColumns,
  money: moneyColumns,
  embedded: (name, snakeName, field) => ({
    [name]: field.multiple === true ? emptyJsonbArray(snakeName) : emptyJsonbObject(snakeName),
  }),
  jsonb: (name, snakeName) => ({ [name]: emptyJsonbObject(snakeName) }),
  date: singleColumnNotNullWhenRequired(plainDate),
  timestamp: singleColumnNotNullWhenRequired(instant),
  tz: singleColumnNotNullWhenRequired(text),
  locatedTimestamp: locatedTimestampColumns,
  // Must match fileRefsTable.id (uuid); anything narrower breaks the reference.
  file: singleColumnNotNullWhenRequired(uuid),
  image: singleColumnNotNullWhenRequired(uuid),
  files: (name, snakeName) => ({ [name]: emptyJsonbArray(snakeName) }),
  images: (name, snakeName) => ({ [name]: emptyJsonbArray(snakeName) }),
};

function emitFieldColumns<K extends FieldType>(
  type: K,
  name: string,
  field: FieldOf<K>,
  entity: EntityDefinition,
): FieldColumns {
  // A type from untyped input must not reach an Object.prototype member.
  if (!Object.hasOwn(COLUMN_EMITTERS, type)) {
    throw new Error(`[Kumiko] unhandled field type: ${String(field)}`);
  }
  const emit: ColumnEmitter<K> = COLUMN_EMITTERS[type];
  return emit(name, toSnakeCase(name), field, entity);
}

// Most fields return one column; money and locatedTimestamp return two.
function fieldToColumns(
  name: string,
  field: FieldDefinition,
  entity: EntityDefinition,
): Record<string, AnyColumnBuilder> {
  return emitFieldColumns(field.type, name, field, entity);
}

// Accepts both camelCase (`tenantMembership`) and kebab-case (`tenant-membership`)
// entity / field names. Implementation lives in utils/case — re-exported here
// for backwards-compatible imports from db/table-builder.

/**
 * Derives a table name from an entity name:
 * 1. camelCase → snake_case (e.g. "memberTask" → "member_task")
 * 2. Simple English pluralization (category→categories, status→statuses, task→tasks)
 * 3. `read_` prefix — marks the table as an event-sourced read model so
 *    it is immediately distinguishable in database tools and application
 *    code is not expected to write to it directly. The event store
 *    (`kumiko_events`) and framework state (`kumiko_*`) use their own
 *    prefixes; ordinary app-side tables without event-sourcing have none.
 *    The three categories are therefore distinguishable in the table browser.
 */
const ES_PLURAL_SUFFIXES = ["s", "sh", "ch", "x"] as const;

export const READ_MODEL_PREFIX = "read_";

export function toTableName(entityName: string): string {
  const snake = toSnakeCase(entityName);
  let plural: string;
  if (snake.endsWith("y") && !/[aeiou]y$/.test(snake)) {
    plural = `${snake.slice(0, -1)}ies`;
  } else if (ES_PLURAL_SUFFIXES.some((suffix) => snake.endsWith(suffix))) {
    plural = `${snake}es`;
  } else {
    plural = `${snake}s`;
  }
  return `${READ_MODEL_PREFIX}${plural}`;
}

// Drizzle's PgTableWithColumns<any> inherits a `[k: string]: any` index
// signature that, in strict mode (noUncheckedIndexedAccess + TS4111), forces
// consumers to use bracket notation even for known columns. Because the
// table is built dynamically from EntityDefinition, TypeScript cannot provide
// Drizzle's full column inference. Instead, we mirror the `fieldToColumns`
// logic in the type system: each field type maps to a concrete data type, and
// ColumnsForEntity builds the complete property bag.
//
// With a concretely inferred `F` (via createEntity({ fields: { ... } })),
// Drizzle's full data typing reaches `eq()`/`select()`/`row.x` at the call
// site. The old `EntityDefinition` without a generic parameter falls back to
// `FieldsMap` for backwards compatibility; without known field types, the
// mapping collapses to `AnyPgColumn`.
//
// Every branch here must match the runtime decision in fieldToColumns. Type
// tests against representative entities in db/__tests__/drizzle-table-types.test.ts
// catch drift.

// Single column handle with concrete data + nullability phantom. After the
// drizzle removal the runtime carries only the snake_case name + pg type
// (see ColumnHandle); the phantom-typed wrapper preserves the existing
// generic-inference call-sites without recreating drizzle's full column
// brand graph.
//
// `__value` carries the TS value type of the column (optional phantom, never present at runtime).
// It is the one place the field → TS-type mapping lives: EntityRow reads it back out of the
// column bag instead of keeping a second map.
type Col<T> = ColumnHandle & { readonly __notNull: true; readonly __value?: T };
type NullCol<T> = ColumnHandle & { readonly __notNull: false; readonly __value?: T };

// Per-field column shape — matches `fieldToColumns`. Money +
// locatedTimestamp produce two-column pairs. `notNull` is propagated from
// `field.required` (the literal is preserved by createXField generics).
type ColumnsForField<K extends string, F extends FieldDefinition> = ValueColumnsForField<K, F> &
  BlindIndexColumnForField<K, F>;

// The blind-index column is a lookup artifact: it exists on the table but coerceRow strips it
// from every row, so EntityRow is built from ValueColumnsForField only.
type BlindIndexColumnForField<K extends string, F extends FieldDefinition> = F extends {
  type: "text";
  lookupable: true;
}
  ? { readonly [P in `${K}Bidx`]: NullCol<string> }
  : unknown;

type ValueColumnsForField<K extends string, F extends FieldDefinition> = F extends {
  type: "text" | "longText" | "select" | "tz";
}
  ? F extends { required: true }
    ? { readonly [P in K]: Col<string> }
    : { readonly [P in K]: NullCol<string> }
  : F extends { type: "boolean" }
    ? // boolean default OR required → notNull (DB has DEFAULT, structurally never-null)
      F extends { default: boolean } | { required: true }
      ? { readonly [P in K]: Col<boolean> }
      : { readonly [P in K]: NullCol<boolean> }
    : F extends { type: "multiSelect" }
      ? // jsonb default `[]`, always notNull
        { readonly [P in K]: Col<readonly string[]> }
      : F extends { type: "number" }
        ? F extends { required: true }
          ? { readonly [P in K]: Col<number> }
          : { readonly [P in K]: NullCol<number> }
        : F extends { type: "decimal" }
          ? F extends { required: true }
            ? { readonly [P in K]: Col<number> }
            : { readonly [P in K]: NullCol<number> }
          : F extends { type: "money" }
            ? F extends { required: true }
              ? { readonly [P in K]: Col<number> } & {
                  readonly [P in `${K}Currency`]: Col<string>;
                }
              : { readonly [P in K]: NullCol<number> } & {
                  readonly [P in `${K}Currency`]: Col<string>;
                }
            : F extends { type: "reference"; multiple: true }
              ? { readonly [P in K]: Col<readonly string[]> }
              : F extends { type: "reference" }
                ? F extends { required: true }
                  ? { readonly [P in K]: Col<string> }
                  : { readonly [P in K]: NullCol<string> }
                : F extends { type: "embedded"; multiple: true }
                  ? // jsonb default `[]`, always non-null. ponytail: the row
                    // type stays untyped like single-embedded; deriving it
                    // from `schema` needs a generic createEmbeddedListField
                    // that captures the literal schema — worth it once a
                    // consumer actually reads rows off the table type.
                    { readonly [P in K]: Col<readonly Readonly<Record<string, unknown>>[]> }
                  : F extends { type: "embedded" }
                    ? // jsonb default `{}`, always notNull
                      { readonly [P in K]: Col<Readonly<Record<string, unknown>>> }
                    : F extends { type: "date" }
                      ? F extends { required: true }
                        ? { readonly [P in K]: Col<Temporal.PlainDate> }
                        : { readonly [P in K]: NullCol<Temporal.PlainDate> }
                      : F extends { type: "timestamp" }
                        ? F extends { required: true }
                          ? { readonly [P in K]: Col<Temporal.Instant> }
                          : { readonly [P in K]: NullCol<Temporal.Instant> }
                        : F extends { type: "locatedTimestamp" }
                          ? F extends { required: true }
                            ? { readonly [P in `${K}Utc`]: Col<Temporal.Instant> } & {
                                readonly [P in `${K}Tz`]: Col<string>;
                              }
                            : { readonly [P in `${K}Utc`]: NullCol<Temporal.Instant> } & {
                                readonly [P in `${K}Tz`]: NullCol<string>;
                              }
                          : F extends { type: "file" | "image" }
                            ? F extends { required: true }
                              ? { readonly [P in K]: Col<string> }
                              : { readonly [P in K]: NullCol<string> }
                            : F extends { type: "files" | "images" }
                              ? { readonly [P in K]: Col<readonly string[]> }
                              : never;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type ColumnsForEntity<F extends FieldsMap> = UnionToIntersection<
  {
    [K in keyof F & string]: ColumnsForField<K, F[K]>;
  }[keyof F & string]
>;

// Base columns from buildBaseColumns — `idType: "serial"` returns number;
// otherwise, UUID-as-string. `insertedAt` has `default(now())`, so it is
// structurally non-null (Drizzle's `notNull` flag matches this).
type BaseColumnsType<E extends EntityDefinition> = {
  readonly id: E extends { idType: "serial" } ? Col<number> : Col<string>;
  readonly tenantId: Col<string>;
  readonly version: Col<number>;
  readonly insertedAt: Col<Temporal.Instant>;
  readonly modifiedAt: NullCol<Temporal.Instant>;
  readonly insertedById: NullCol<string>;
  readonly modifiedById: NullCol<string>;
};

// Soft-delete columns exist only when entity.softDelete === true. The type
// level cannot narrow this without a generic for softDelete, so both sets are
// unioned — lean entities see the never-present columns as typed, matching
// the previous `<any>` behavior.
type SoftDeleteColumnsType = {
  readonly isDeleted: Col<boolean>;
  readonly deletedAt: NullCol<Temporal.Instant>;
  readonly deletedById: NullCol<string>;
};

// ── Row type of executor.list()/detail() ────────────────────────────────
// Read back out of the column bags above (the `__value` phantom) so there is no second
// field → TS-type map. Two things differ from the table and are spelled out:
//   - money / locatedTimestamp are ONE key in the row (rehydrateCompoundTypes folds the column
//     pair), and an unset one is absent, not null.
//   - the blind-index column never reaches a row (see BlindIndexColumnForField).
type ColumnValue<C> = C extends { readonly __notNull: true; readonly __value?: infer T }
  ? T
  : C extends { readonly __notNull: false; readonly __value?: infer T }
    ? T | null
    : unknown;

type RowOfColumns<C> = { readonly [K in keyof C]: ColumnValue<C[K]> };

type CompoundRowField<K extends string, V, F> = F extends { required: true }
  ? { readonly [P in K]: V }
  : { readonly [P in K]?: V };

// Field types the table type has no column for (bigInt, jsonb) stay honest as `unknown`.
type RowForField<K extends string, F extends FieldDefinition> = F extends { type: "money" }
  ? CompoundRowField<K, MoneyRead, F>
  : F extends { type: "locatedTimestamp" }
    ? CompoundRowField<K, LocatedTimestampRead, F>
    : [ValueColumnsForField<K, F>] extends [never]
      ? { readonly [P in K]: unknown }
      : RowOfColumns<ValueColumnsForField<K, F>>;

type RowForFields<F extends FieldsMap> = UnionToIntersection<
  {
    [K in keyof F & string]: RowForField<K, F[K]>;
  }[keyof F & string]
>;

// A literal `softDelete: true` makes the three keys certain. createEntity widens the flag to
// `boolean`, so there the keys are present only on soft-delete entities: optional.
type SoftDeleteRow<E extends EntityDefinition> = E["softDelete"] extends true
  ? RowOfColumns<SoftDeleteColumnsType>
  : [E["softDelete"]] extends [false | undefined]
    ? unknown
    : Partial<RowOfColumns<SoftDeleteColumnsType>>;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

/** The row `executor.list()` / `executor.detail()` return for entity `E`. A wide
 *  `EntityDefinition` (fields without literal keys) yields `Record<string, unknown>`. */
export type EntityRow<E extends EntityDefinition = EntityDefinition> =
  string extends keyof E["fields"]
    ? Record<string, unknown>
    : Flatten<RowOfColumns<BaseColumnsType<E>> & SoftDeleteRow<E> & RowForFields<E["fields"]>>;

// ── ES-write brand ──────────────────────────────────────────────────────
export type {
  ExecutorManagedRunner,
  ExecutorManagedWriteCapability,
  Writable,
  WritableSchemaTable,
  WritableTable,
} from "@cosmicdrift/kumiko-types/executor-brand";
// ── Tenancy brand ────────────────────────────────────────────────────────
export type { EntityTenancy, TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";

// `E extends { tenancy?: "global" }` would wrongly match any E missing
// `tenancy` too (an absent optional property structurally satisfies an
// optional one) — index into E["tenancy"] instead so only a literal
// "global" (not undefined/"tenant"/a union/never) brands "global".
type EntityTableTenancy<E extends EntityDefinition> = [NonNullable<E["tenancy"]>] extends [never]
  ? "tenant"
  : [NonNullable<E["tenancy"]>] extends ["global"]
    ? "global"
    : "tenant";

export type EntityTable<E extends EntityDefinition = EntityDefinition> = TableColumns &
  BaseColumnsType<E> &
  SoftDeleteColumnsType &
  ColumnsForEntity<E["fields"]> &
  TenancyBrand<EntityTableTenancy<E>>;

export function buildBaseColumns(softDelete: boolean, idType: "serial" | "uuid" = "uuid") {
  const idColumn =
    idType === "uuid"
      ? uuid("id").primaryKey().default(sql`gen_random_uuid()`)
      : serial("id").primaryKey();

  const base = {
    id: idColumn,
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").default(1).notNull(),
    // Temporal.Instant is used throughout (see instant() in dialect.ts).
    // Previously the default mode was "date", which was inconsistent with
    // user-defined timestamp fields (mode "string"). A single mode is now
    // used for all timestamps.
    // customType doesn't expose Drizzle's `defaultNow()` shortcut — use raw
    // SQL so PG sets the value on insert and callers need not pass an
    // Instant for every row creation.
    insertedAt: instant("inserted_at").default(sql`now()`).notNull(),
    modifiedAt: instant("modified_at"),
    // User-IDs are stringified UUIDs post-ES migration. Text (not uuid) so the
    // columns accept system actors ("SYSTEM", "SEED", etc.) and legacy-shaped
    // integer ids during transitional tests.
    insertedById: text("inserted_by_id"),
    modifiedById: text("modified_by_id"),
  };

  if (softDelete) {
    return {
      ...base,
      isDeleted: boolean("is_deleted").default(false).notNull(),
      deletedAt: instant("deleted_at"),
      deletedById: text("deleted_by_id"),
    };
  }

  return base;
}

const ROW_META_BASE: ReadonlySet<string> = new Set(Object.keys(buildBaseColumns(false)));
const ROW_META_WITH_SOFT_DELETE: ReadonlySet<string> = new Set(Object.keys(buildBaseColumns(true)));

// Row-meta columns exist on every row without being declared entity fields, so the
// boot-validator must treat them as known when an action picks/maps/gates on them.
// softDelete-only columns stay unknown for non-softDelete entities — gating on them
// there is a real misconfiguration, not a row-meta reference.
export function rowMetaFieldNames(softDelete: boolean): ReadonlySet<string> {
  return softDelete ? ROW_META_WITH_SOFT_DELETE : ROW_META_BASE;
}

export type BuildEntityTableOptions = {
  readonly featureName?: string;
  // Relations declared for this entity. When present, every belongsTo
  // foreignKey gets an index — otherwise joins and `WHERE fk = ?` filters
  // sequential-scan the child table. Pass the output of
  // `registry.getRelations(entityName)` or the raw relations block.
  readonly relations?: EntityRelations;
};

// pgTable's own meta stamp sees neither entity.tenancy nor that this table is an executor-managed projection;
// patch both so db.global()'s runtime guards match the type brands.
function stampEntityTableMeta<E extends EntityDefinition>(table: EntityTable<E>, entity: E): void {
  const meta = (table as unknown as Record<symbol, EntityTableMeta>)[KUMIKO_META_SYMBOL];
  // skip: no meta stamp present — nothing to patch
  if (!meta) return;
  (table as unknown as Record<symbol, EntityTableMeta>)[KUMIKO_META_SYMBOL] = {
    ...meta,
    source: "managed",
    ...(entity.tenancy === "global" && { tenancy: "global" as const }),
  };
}

/**
 * Stamps `tenancy: "global"` onto a `table()`/SchemaTable's meta in place.
 * Throws if the table has a `tenant_id` column or no EntityTableMeta to stamp.
 */
export function declareGlobalTenancy<T extends SchemaTable>(table: T): T & TenancyBrand<"global"> {
  const meta = (table as unknown as Record<symbol, EntityTableMeta | undefined>)[
    KUMIKO_META_SYMBOL
  ];
  if (!meta) {
    throw new Error("declareGlobalTenancy(): table has no EntityTableMeta to stamp.");
  }
  if (meta.columns.some((c) => c.name === "tenant_id")) {
    throw new Error(
      `declareGlobalTenancy("${meta.tableName}"): tables with a "tenant_id" column cannot be ` +
        'declared tenancy: "global" — a global table\'s rows carry the system tenant, not a ' +
        "per-row tenant identity.",
    );
  }
  (table as unknown as Record<symbol, EntityTableMeta>)[KUMIKO_META_SYMBOL] = {
    ...meta,
    tenancy: "global",
  };
  // @cast-boundary phantom-brand — TenancyBrand<"global"> is a phantom marker with no runtime representation.
  return table as T & TenancyBrand<"global">;
}

export function buildEntityTable<E extends EntityDefinition>(
  entityName: string,
  entity: E,
  options?: BuildEntityTableOptions,
): EntityTable<E> {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false, entity.idType ?? "uuid");
  const fieldColumns: Record<string, AnyColumnBuilder> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const cols = fieldToColumns(name, field, entity);
    Object.assign(fieldColumns, cols);
  }

  // Default table name derived from entityName (e.g. "memberTask" → "read_member_tasks")
  const baseTableName = entity.table ?? toTableName(entityName);
  // The featureName prefix is inserted between read_ and the base name so
  // all read models consistently start with `read_`, whether or not
  // featureName is set. Examples:
  //   featureName="shop", base="read_orders"  →  "read_shop_orders"
  //   featureName=undef,  base="read_orders"  →  "read_orders"
  //   featureName="shop", base="orders" (no read_)  →  "shop_orders"
  const tableName = options?.featureName
    ? baseTableName.startsWith(READ_MODEL_PREFIX)
      ? `${READ_MODEL_PREFIX}${options.featureName}_${baseTableName.slice(READ_MODEL_PREFIX.length)}`
      : `${options.featureName}_${baseTableName}`
    : baseTableName;

  // Build the list of foreign-key columns to index. Sources:
  //  (a) single-file / single-image fields store a fileRef id and are queried
  //      by that id whenever a detail view resolves attachments.
  //  (b) belongsTo relations declared via r.relation() — the FK column is the
  //      parent-side lookup key; without an index every child join scans the
  //      full table.
  // `Set` keeps the list deduplicated when (a) and (b) name the same column.
  const foreignKeyFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "file" || field.type === "image") {
      foreignKeyFields.add(name);
    }
  }
  if (options?.relations) {
    for (const rel of Object.values(options.relations)) {
      if (rel.type === "belongsTo") foreignKeyFields.add(rel.foreignKey);
    }
  }

  // Cast back to EntityTable<E>: drizzle-kit's pgTable returns a fully
  // inferred PgTableWithColumns over the *exact* column-builder map we
  // hand in. Our typed signature narrows that to the static names from
  // EntityDefinition (kept in sync with fieldToColumns + buildBaseColumns).
  // Drizzle's runtime instance carries every needed method on top.
  const built = pgTable(
    tableName,
    {
      ...baseColumns,
      ...fieldColumns,
    },
    // Every multi-tenant query filters by tenant_id. Without this index, list
    // queries scan the whole table across all tenants. Applies to every table
    // built via buildEntityTable since every entity inherits tenantId.
    (table) => {
      const indexes: Record<string, IndexBuilderWithCols> = {};
      const tHandle = table as unknown as Record<string, ColumnHandle>;
      indexes[`${tableName}_tenant_id_idx`] = index(`${tableName}_tenant_id_idx`).on(
        // biome-ignore lint/style/noNonNullAssertion: tenantId column always exists on entity tables
        tHandle["tenantId"]!,
      );
      for (const fieldName of foreignKeyFields) {
        const column = tHandle[fieldName];
        if (column) {
          indexes[`${tableName}_${toSnakeCase(fieldName)}_idx`] = index(
            `${tableName}_${toSnakeCase(fieldName)}_idx`,
          ).on(column);
        }
      }
      // lookupable fields: index the bidx column (kept in lockstep with
      // deriveEntityTableMeta).
      const bidxFieldByField = new Map<string, string>();
      for (const [name, field] of Object.entries(entity.fields)) {
        if (field.type !== "text" || field.lookupable !== true) continue;
        bidxFieldByField.set(name, `${name}Bidx`);
        const column = tHandle[`${name}Bidx`];
        if (column) {
          const idxName = `${tableName}_${toSnakeCase(name)}_bidx_idx`;
          indexes[idxName] = index(idxName).on(column);
        }
      }
      // entity.indexes contains composite/unique indexes explicitly declared by
      // the author. Columns are addressed by field name (camelCase), and the
      // index name follows <table>_<col1>_<col2>_<unique|idx>; index.name can
      // override the convention.
      for (const def of entity.indexes ?? []) {
        const cols = def.columns
          .map((fieldName) => tHandle[fieldName])
          .filter((col): col is ColumnHandle => col !== undefined);
        if (cols.length !== def.columns.length) continue;
        const suffix = def.unique === true ? "unique" : "idx";
        const indexName =
          def.name ?? `${tableName}_${def.columns.map((c) => toSnakeCase(c)).join("_")}_${suffix}`;
        const builder = def.unique === true ? uniqueIndex(indexName) : index(indexName);
        let chain = builder.on(...cols);
        // entity.indexes[].where is now a SqlExpression (was drizzle SQL).
        // Pass through to the IndexBuilderWithCols.where()-API.
        if (def.where !== undefined) {
          // A silently dropped where would build a full (unique) index that
          // entity-table-meta flags as needsManualWhere.
          if (!isSqlExpression(def.where)) {
            throw new Error(
              `[${tableName}] index "${indexName}": where must be a sql\`...\` expression`,
            );
          }
          chain = chain.where(def.where);
        } else if (def.unique === true && entity.softDelete === true) {
          // Soft-deleted rows keep their value, so a full unique index would
          // permanently block reuse; kept in lock-step with entity-table-meta.ts.
          chain = chain.where(sql.raw(SOFT_DELETE_LIVE_ROW_PREDICATE));
        }
        indexes[indexName] = chain;
        // Partial bidx counterpart for unique indexes over lookupable fields
        // (kept in lockstep with deriveEntityTableMeta).
        if (def.unique === true && def.where === undefined) {
          const bidxFieldNames = def.columns.map((c) => bidxFieldByField.get(c) ?? c);
          if (bidxFieldNames.some((c, i) => c !== def.columns[i])) {
            const bidxCols = bidxFieldNames
              .map((c) => tHandle[c])
              .filter((col): col is ColumnHandle => col !== undefined);
            if (bidxCols.length === bidxFieldNames.length) {
              const notNullParts = bidxFieldNames
                .filter((c, i) => c !== def.columns[i])
                .map((c) => `"${toSnakeCase(c)}" IS NOT NULL`);
              // Soft-deleted rows keep their bidx hash — without this, a
              // restored row can't reuse a value a soft-deleted sibling still
              // holds.
              const whereText = (
                entity.softDelete === true
                  ? [...notNullParts, SOFT_DELETE_LIVE_ROW_PREDICATE]
                  : notNullParts
              ).join(" AND ");
              const partialWhere = sql.raw(whereText);
              indexes[`${indexName}_bidx`] = uniqueIndex(`${indexName}_bidx`)
                .on(...bidxCols)
                .where(partialWhere);
            }
          }
        }
      }
      return indexes;
    },
  ) as unknown as EntityTable<E>;

  stampEntityTableMeta(built, entity);
  markExecutorManagedTable(built, { entityName, entity });
  return built;
}

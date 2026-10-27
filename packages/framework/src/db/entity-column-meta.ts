// Field definition → physical ColumnMeta[]. Lock-step twin of COLUMN_EMITTERS
// in table-builder.ts: every field type must produce the same PG columns there.

import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { toSnakeCase } from "../utils/case.ts";
import type { ColumnMeta, PgType } from "./entity-table-meta-types.ts";

type FieldType = FieldDefinition["type"];
type FieldOf<K extends FieldType> = Extract<FieldDefinition, { type: K }>;
type RequirableField = { readonly required?: boolean };
type ColumnMetaEmitter<K extends FieldType> = (
  snake: string,
  field: FieldOf<K>,
  entity: EntityDefinition,
) => readonly ColumnMeta[];

const EMPTY_JSONB_ARRAY = "'[]'::jsonb";
const EMPTY_JSONB_OBJECT = "'{}'::jsonb";

function quoteSql(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`;
}

function fieldDefaultLiteral(field: FieldDefinition): string | undefined {
  if (!("default" in field) || field.default === undefined) return undefined;
  const v = field.default;
  if (typeof v === "string") return quoteSql(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
}

function declaredDefault(field: FieldDefinition): { readonly defaultSql?: string } {
  const literal = fieldDefaultLiteral(field);
  return literal === undefined ? {} : { defaultSql: literal };
}

function scalarColumn(
  snake: string,
  pgType: PgType,
  field: FieldDefinition & RequirableField,
  extra: Partial<ColumnMeta> = {},
): ColumnMeta {
  return {
    name: snake,
    pgType,
    notNull: field.required === true,
    ...extra,
    ...declaredDefault(field),
  };
}

function requiredColumn(
  snake: string,
  pgType: PgType,
  field: RequirableField,
): readonly ColumnMeta[] {
  return [{ name: snake, pgType, notNull: field.required === true }];
}

function jsonbColumn(snake: string, defaultSql: string): readonly ColumnMeta[] {
  return [{ name: snake, pgType: "jsonb", notNull: true, defaultSql }];
}

// lookupable → HMAC blind-index counterpart. Nullable is mandatory:
// managedChangeRequiresRecreate would diff a NOT-NULL column without
// a default on existing tables as DROP+rebuild.
const textColumnMeta = (snake: string, field: FieldOf<"text" | "longText">): ColumnMeta[] => {
  const cols = [scalarColumn(snake, "text", field)];
  if (field.type === "text" && field.lookupable === true) {
    cols.push({ name: `${snake}_bidx`, pgType: "text", notNull: false });
  }
  return cols;
};

const booleanColumnMeta: ColumnMetaEmitter<"boolean"> = (snake, field) => {
  const declared = declaredDefault(field);
  return [
    {
      name: snake,
      pgType: "boolean",
      notNull: declared.defaultSql !== undefined || field.required === true,
      ...declared,
    },
  ];
};

const referenceColumnMeta: ColumnMetaEmitter<"reference"> = (snake, field) =>
  field.multiple === true
    ? jsonbColumn(snake, EMPTY_JSONB_ARRAY)
    : requiredColumn(snake, "uuid", field);

const moneyColumnMeta: ColumnMetaEmitter<"money"> = (snake, field, entity) => [
  { name: snake, pgType: "bigint", notNull: field.required === true, bigintJsMode: "bigint" },
  {
    name: `${snake}_currency`,
    pgType: "text",
    notNull: true,
    defaultSql: quoteSql(entity.defaultCurrency ?? "EUR"),
  },
];

const locatedTimestampColumnMeta: ColumnMetaEmitter<"locatedTimestamp"> = (snake, field) => [
  { name: `${snake}_utc`, pgType: "timestamptz", notNull: field.required === true },
  { name: `${snake}_tz`, pgType: "text", notNull: field.required === true },
];

const COLUMN_META_EMITTERS: { readonly [K in FieldType]: ColumnMetaEmitter<K> } = {
  text: textColumnMeta,
  longText: textColumnMeta,
  boolean: booleanColumnMeta,
  select: (snake, field) => [scalarColumn(snake, "text", field)],
  multiSelect: (snake) => jsonbColumn(snake, EMPTY_JSONB_ARRAY),
  number: (snake, field) => [
    scalarColumn(snake, field.integer === true ? "integer" : "double precision", field),
  ],
  bigInt: (snake, field) => [scalarColumn(snake, "bigint", field, { bigintJsMode: "number" })],
  decimal: (snake, field) => [
    scalarColumn(snake, `numeric(${field.precision},${field.scale})`, field),
  ],
  reference: referenceColumnMeta,
  money: moneyColumnMeta,
  embedded: (snake, field) =>
    jsonbColumn(snake, field.multiple === true ? EMPTY_JSONB_ARRAY : EMPTY_JSONB_OBJECT),
  jsonb: (snake, field) =>
    jsonbColumn(snake, field.emptyValue === "array" ? EMPTY_JSONB_ARRAY : EMPTY_JSONB_OBJECT),
  // Real PG `date` — Temporal.PlainDate, no time-of-day/timezone component.
  date: (snake, field) => requiredColumn(snake, "date", field),
  timestamp: (snake, field) => requiredColumn(snake, "timestamptz", field),
  tz: (snake, field) => requiredColumn(snake, "text", field),
  locatedTimestamp: locatedTimestampColumnMeta,
  file: (snake, field) => requiredColumn(snake, "uuid", field),
  image: (snake, field) => requiredColumn(snake, "uuid", field),
  files: (snake) => jsonbColumn(snake, EMPTY_JSONB_ARRAY),
  images: (snake) => jsonbColumn(snake, EMPTY_JSONB_ARRAY),
};

function emitColumnMeta<K extends FieldType>(
  type: K,
  snake: string,
  field: FieldOf<K>,
  entity: EntityDefinition,
): readonly ColumnMeta[] {
  // A type from untyped input must not reach an Object.prototype member.
  if (!Object.hasOwn(COLUMN_META_EMITTERS, type)) return [];
  const emit: ColumnMetaEmitter<K> = COLUMN_META_EMITTERS[type];
  return emit(snake, field, entity);
}

export function fieldToColumnMeta(
  name: string,
  field: FieldDefinition,
  entity: EntityDefinition,
): readonly ColumnMeta[] {
  return emitColumnMeta(field.type, toSnakeCase(name), field, entity);
}

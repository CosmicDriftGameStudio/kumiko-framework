import {
  ZodArray,
  ZodCatch,
  ZodDefault,
  ZodIntersection,
  ZodLazy,
  ZodNonOptional,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodPipe,
  ZodPrefault,
  ZodReadonly,
  ZodRecord,
  ZodTuple,
  type ZodType,
  ZodUnion,
  ZodXor,
} from "zod";
import type { $ZodType } from "zod/v4/core";

// Drills through wrapper types (.nullable(), .optional(), .default()) a
// handler's schema may use around its actual object/array shape — e.g. a
// detail query returning `Row | null` when the record doesn't exist.
// Bounded to avoid looping on a pathological schema.
function unwrapZodType(schema: ZodType): ZodType {
  let current: ZodType = schema;
  for (let i = 0; i < 8; i++) {
    if (
      current instanceof ZodOptional ||
      current instanceof ZodNullable ||
      current instanceof ZodDefault
    ) {
      // @cast-boundary schema-walk — Zod v4's .unwrap() types its result as
      // the core $ZodType, not the z.ZodType wrapper; same runtime instance
      // (see env/_zod-introspect.ts for the same drill on ZodDefault/Optional).
      current = current.unwrap() as ZodType;
      continue;
    }
    break;
  }
  return current;
}

// Non-ZodObject schemas (e.g. a z.union across payload shapes) and an
// absent schema both fall through to "shape unknown" — callers treat that
// as "capability absent" and skip the check rather than throwing, the same
// policy projection-list-screens.ts already uses for input-schema checks.
export function getZodObjectShape(
  schema: ZodType | undefined,
): Record<string, ZodType> | undefined {
  if (schema === undefined) return undefined;
  const unwrapped = unwrapZodType(schema);
  return unwrapped instanceof ZodObject ? unwrapped.shape : undefined;
}

// The shape of one row for a query whose result follows the paged-list
// contract `{ rows: T[], nextCursor, total? }` (projectionList/relatedList/
// dashboard-list `query`) — unwraps `rows` (a ZodArray) to its element
// schema, then that element's own shape.
export function getZodRowShape(schema: ZodType | undefined): Record<string, ZodType> | undefined {
  const objectShape = getZodObjectShape(schema);
  const rowsField = objectShape?.["rows"];
  if (rowsField === undefined) return undefined;
  const rowsArray = unwrapZodType(rowsField);
  // @cast-boundary schema-walk — same core-vs-wrapper gap as .unwrap() above.
  return rowsArray instanceof ZodArray
    ? getZodObjectShape(rowsArray.element as ZodType)
    : undefined;
}

type SingleInnerSchema =
  | ZodOptional
  | ZodNullable
  | ZodDefault
  | ZodPrefault
  | ZodNonOptional
  | ZodCatch
  | ZodReadonly
  | ZodLazy;

const SINGLE_INNER_SCHEMA_CLASSES = [
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodPrefault,
  ZodNonOptional,
  ZodCatch,
  ZodReadonly,
  ZodLazy,
] as const;

function isSingleInnerSchema(schema: $ZodType): schema is SingleInnerSchema {
  return SINGLE_INNER_SCHEMA_CLASSES.some((schemaClass) => schema instanceof schemaClass);
}

function combinatorChildSchemas(schema: $ZodType): readonly $ZodType[] {
  if (schema instanceof ZodUnion || schema instanceof ZodXor) return schema.options;
  if (schema instanceof ZodIntersection) return [schema.def.left, schema.def.right];
  // z.preprocess() carries the accepted shape on `out`, .transform() on `in`.
  if (schema instanceof ZodPipe) return [schema.in, schema.out];
  return [];
}

function childSchemas(schema: $ZodType): readonly $ZodType[] {
  if (schema instanceof ZodObject) return Object.values(schema.shape);
  if (schema instanceof ZodArray) return [schema.element];
  if (schema instanceof ZodRecord) return [schema.valueType];
  if (schema instanceof ZodTuple) {
    const { items, rest } = schema.def;
    return rest ? [...items, rest] : items;
  }
  if (isSingleInnerSchema(schema)) return [schema.unwrap()];
  return combinatorChildSchemas(schema);
}

// A z.lazy() getter that builds a fresh schema per call never revisits a node.
const MAX_WALKED_SCHEMAS = 10_000;

// Object keys at any depth, so a field nested in an intersection, union or an
// update's `changes` object is found too.
export function collectZodObjectKeys(schema: $ZodType | undefined): ReadonlySet<string> {
  const keys = new Set<string>();
  if (schema === undefined) return keys;
  const visited = new Set<$ZodType>();
  const pending: $ZodType[] = [schema];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (visited.has(next)) continue;
    if (visited.size >= MAX_WALKED_SCHEMAS) {
      throw new Error(
        `collectZodObjectKeys: schema has more than ${MAX_WALKED_SCHEMAS} nodes — ` +
          "a z.lazy() getter probably returns a new schema on every call; hoist it into a constant.",
      );
    }
    visited.add(next);
    if (next instanceof ZodObject) {
      for (const key of Object.keys(next.shape)) keys.add(key);
    }
    pending.push(...childSchemas(next));
  }
  return keys;
}

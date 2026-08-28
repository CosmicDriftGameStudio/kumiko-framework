import { ZodArray, ZodDefault, ZodNullable, ZodObject, ZodOptional, type ZodType } from "zod";

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

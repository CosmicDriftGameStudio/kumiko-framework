// Zod v4 runtime-introspection helpers. Each cast is a deliberate
// schema-walk into Zod's internal shape (`_def`, `.meta()`, `.shape[k]`).
// Centralised here so the as-cast audit's @cast-boundary schema-walk
// markers live in one place rather than scattered through callers.
//
// All helpers accept the *runtime* Zod instance — TypeScript wrapper
// (`z.ZodType`) and core (`$ZodType`) are the same object at runtime.

import type { z } from "zod";

export type ZodDef = {
  readonly innerType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly defaultValue?: unknown;
};

/** Read Zod v4 `.meta()` value. Undefined when no meta is set. */
export function zodMeta(field: z.ZodType): unknown {
  // @cast-boundary schema-walk
  const fn = (field as { meta?: () => unknown }).meta;
  return typeof fn === "function" ? fn.call(field) : undefined;
}

/** Read the `_def` slot used by ZodDefault/ZodOptional drilling. */
export function zodDef(field: z.ZodType): ZodDef | undefined {
  // @cast-boundary schema-walk
  return (field as { _def?: ZodDef })._def;
}

/** Read the field-level `.describe()` value. */
export function zodDescription(field: z.ZodType): string | undefined {
  // @cast-boundary schema-walk
  const desc = (field as { description?: string }).description;
  return typeof desc === "string" && desc.length > 0 ? desc : undefined;
}

/** Treat a ZodObject's `shape` values as `z.ZodType`. Zod v4 typing
 *  exposes them as `$ZodType` (core) — same runtime instance. */
export function zodShape(schema: z.ZodObject<z.ZodRawShape>): Record<string, z.ZodType> {
  // @cast-boundary schema-walk
  return schema.shape as Record<string, z.ZodType>;
}

/** Look up a single field on a ZodObject's shape. */
export function zodShapeField(
  schema: z.ZodObject<z.ZodRawShape>,
  name: string,
): z.ZodType | undefined {
  // @cast-boundary schema-walk
  return schema.shape[name] as z.ZodType | undefined;
}

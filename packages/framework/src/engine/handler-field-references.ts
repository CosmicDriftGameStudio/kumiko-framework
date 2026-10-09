import { ZodObject, type ZodType } from "zod";
import { zodDef, zodMeta, zodShapeField } from "../env/_zod-introspect.js";

export const HANDLER_FIELD_REFERENCES_META_KEY = "references";

const MAX_WRAPPER_DEPTH = 8;

function referencesFromMeta(field: ZodType): string | undefined {
  const meta = zodMeta(field);
  if (typeof meta !== "object" || meta === null) return undefined;
  const value = Reflect.get(meta, HANDLER_FIELD_REFERENCES_META_KEY);
  return typeof value === "string" ? value : undefined;
}

// `.optional()` / `.nullable()` / `.default()` after `.meta()` hide the meta
// from the outer type, so every wrapper layer is probed on the way in.
export function handlerFieldReference(schema: ZodType, field: string): string | undefined {
  let current: ZodType | undefined = schema;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && current !== undefined; depth++) {
    if (current instanceof ZodObject) break;
    current = zodDef(current)?.innerType;
  }
  if (!(current instanceof ZodObject)) return undefined;
  let fieldSchema = zodShapeField(current, field);
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && fieldSchema !== undefined; depth++) {
    const reference = referencesFromMeta(fieldSchema);
    if (reference !== undefined) return reference;
    fieldSchema = zodDef(fieldSchema)?.innerType;
  }
  return undefined;
}

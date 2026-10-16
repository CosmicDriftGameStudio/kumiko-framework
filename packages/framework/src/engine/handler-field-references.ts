import * as z from "zod";
import { zodDef, zodMeta, zodShapeField } from "../env/_zod-introspect.js";

export const HANDLER_FIELD_REFERENCES_META_KEY = "references";

// `by` names a business key of the target entity instead of its id. The framework only
// validates that the field exists; resolving key to record is the consumer's query.
export type HandlerFieldReferenceMeta = string | { readonly entity: string; readonly by?: string };

export type HandlerFieldReference = {
  readonly entity: string;
  // undefined = the value is the record id.
  readonly by: string | undefined;
  // true = the field is an array of ids / business keys.
  readonly multiple: boolean;
};

export type HandlerFieldReferenceReading =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly raw: unknown }
  | { readonly kind: "ok"; readonly reference: HandlerFieldReference };

const MAX_WRAPPER_DEPTH = 8;

const referenceMetaSchema = z.union([
  z.string().min(1),
  z.object({ entity: z.string().min(1), by: z.string().min(1).optional() }),
]);

function rawReferenceMeta(field: z.ZodType): unknown {
  const meta = zodMeta(field);
  if (typeof meta !== "object" || meta === null) return undefined;
  return Reflect.get(meta, HANDLER_FIELD_REFERENCES_META_KEY);
}

function unwrapObjectSchema(schema: z.ZodType): z.ZodObject | undefined {
  let current: z.ZodType | undefined = schema;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && current !== undefined; depth++) {
    if (current instanceof z.ZodObject) return current;
    current = zodDef(current)?.innerType;
  }
  return undefined;
}

// `.optional()` / `.nullable()` / `.default()` after `.meta()` hide the meta from the outer
// type, so every wrapper layer is probed on the way in; array elements are probed too.
function findRawReferenceMeta(field: z.ZodType): unknown {
  let current: z.ZodType | undefined = field;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && current !== undefined; depth++) {
    const raw = rawReferenceMeta(current);
    if (raw !== undefined) return raw;
    current = current instanceof z.ZodArray ? zodDef(current)?.element : zodDef(current)?.innerType;
  }
  return undefined;
}

function isArrayField(field: z.ZodType): boolean {
  let current: z.ZodType | undefined = field;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && current !== undefined; depth++) {
    if (current instanceof z.ZodArray) return true;
    current = zodDef(current)?.innerType;
  }
  return false;
}

export function readHandlerFieldReference(
  schema: z.ZodType,
  field: string,
): HandlerFieldReferenceReading {
  const objectSchema = unwrapObjectSchema(schema);
  const fieldSchema = objectSchema && zodShapeField(objectSchema, field);
  if (fieldSchema === undefined) return { kind: "none" };
  const raw = findRawReferenceMeta(fieldSchema);
  if (raw === undefined) return { kind: "none" };
  const parsed = referenceMetaSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid", raw };
  const meta = parsed.data;
  return {
    kind: "ok",
    reference: {
      entity: typeof meta === "string" ? meta : meta.entity,
      by: typeof meta === "string" ? undefined : meta.by,
      multiple: isArrayField(fieldSchema),
    },
  };
}

export function handlerFieldReference(
  schema: z.ZodType,
  field: string,
): HandlerFieldReference | undefined {
  const reading = readHandlerFieldReference(schema, field);
  return reading.kind === "ok" ? reading.reference : undefined;
}

import * as z from "zod";
import { zodDef, zodMeta, zodShape, zodShapeField } from "../env/_zod-introspect.ts";

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

// Repetition over arrays / records lives in the path segments; `multiple` only describes
// the leaf field itself.
export type HandlerFieldPathSegment =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "element" }
  | { readonly kind: "recordKey" }
  | { readonly kind: "recordValue" };

export type HandlerFieldReferenceAtPath = {
  // e.g. "customerId", "channels[].channelKey", "labels{key}", "labels{}.channelKey"
  readonly path: string;
  readonly segments: readonly HandlerFieldPathSegment[];
  readonly reading: Exclude<HandlerFieldReferenceReading, { kind: "none" }>;
};

const MAX_WRAPPER_DEPTH = 8;
const MAX_NESTING_DEPTH = 8;

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

function readFieldReference(fieldSchema: z.ZodType): HandlerFieldReferenceReading {
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

export function readHandlerFieldReference(
  schema: z.ZodType,
  field: string,
): HandlerFieldReferenceReading {
  const objectSchema = unwrapObjectSchema(schema);
  const fieldSchema = objectSchema && zodShapeField(objectSchema, field);
  if (fieldSchema === undefined) return { kind: "none" };
  return readFieldReference(fieldSchema);
}

function pathOf(segments: readonly HandlerFieldPathSegment[]): string {
  let path = "";
  for (const segment of segments) {
    if (segment.kind === "field") path += path === "" ? segment.name : `.${segment.name}`;
    else if (segment.kind === "element") path += "[]";
    else if (segment.kind === "recordKey") path += "{key}";
    else path += "{}";
  }
  return path;
}

function collectAt(
  schema: z.ZodType,
  segments: readonly HandlerFieldPathSegment[],
  out: HandlerFieldReferenceAtPath[],
): void {
  const reading = readFieldReference(schema);
  if (reading.kind !== "none") out.push({ path: pathOf(segments), segments, reading });
}

function walkNested(
  schema: z.ZodType,
  segments: readonly HandlerFieldPathSegment[],
  depth: number,
  out: HandlerFieldReferenceAtPath[],
): void {
  // skip: schemas nested deeper than MAX_NESTING_DEPTH are not inspected
  if (depth > MAX_NESTING_DEPTH) return;
  let current: z.ZodType | undefined = schema;
  let currentSegments = segments;
  for (let layer = 0; layer < MAX_WRAPPER_DEPTH && current !== undefined; layer++) {
    if (current instanceof z.ZodObject) {
      walkObject(current, currentSegments, depth, out);
      break;
    }
    if (current instanceof z.ZodRecord) {
      const { keyType, valueType } = current;
      if (keyType instanceof z.ZodType) {
        collectAt(keyType, [...currentSegments, { kind: "recordKey" }], out);
      }
      if (valueType instanceof z.ZodType) {
        const valueSegments = [...currentSegments, { kind: "recordValue" } as const];
        collectAt(valueType, valueSegments, out);
        walkNested(valueType, valueSegments, depth + 1, out);
      }
      break;
    }
    if (current instanceof z.ZodArray) {
      currentSegments = [...currentSegments, { kind: "element" }];
      current = zodDef(current)?.element;
      continue;
    }
    current = zodDef(current)?.innerType;
  }
}

function walkObject(
  objectSchema: z.ZodObject,
  segments: readonly HandlerFieldPathSegment[],
  depth: number,
  out: HandlerFieldReferenceAtPath[],
): void {
  for (const [name, fieldSchema] of Object.entries(zodShape(objectSchema))) {
    const fieldSegments = [...segments, { kind: "field", name } as const];
    collectAt(fieldSchema, fieldSegments, out);
    walkNested(fieldSchema, fieldSegments, depth + 1, out);
  }
}

/** All reference metas of a handler input schema, including fields nested in arrays,
 *  objects and records. `z.lazy()` is not followed. */
export function readHandlerFieldReferences(
  schema: z.ZodType,
): readonly HandlerFieldReferenceAtPath[] {
  const objectSchema = unwrapObjectSchema(schema);
  if (objectSchema === undefined) return [];
  const out: HandlerFieldReferenceAtPath[] = [];
  walkObject(objectSchema, [], 0, out);
  return out;
}

export function handlerFieldReferences(schema: z.ZodType): readonly {
  readonly path: string;
  readonly segments: readonly HandlerFieldPathSegment[];
  readonly reference: HandlerFieldReference;
}[] {
  return readHandlerFieldReferences(schema).flatMap(({ path, segments, reading }) =>
    reading.kind === "ok" ? [{ path, segments, reference: reading.reference }] : [],
  );
}

export function handlerFieldReference(
  schema: z.ZodType,
  field: string,
): HandlerFieldReference | undefined {
  const reading = readHandlerFieldReference(schema, field);
  return reading.kind === "ok" ? reading.reference : undefined;
}

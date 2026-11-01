import type { QueryHandlerDef, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_ONLY_JSON_SCHEMA_KEY } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";

// Agent dispatch never runs as a system identity, so properties the engine only
// honors for system callers would be silently dropped — hide them from the tool.
export function systemOnlyPropertyNames(jsonSchema: Record<string, unknown>): readonly string[] {
  const properties = jsonSchema["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  return Object.entries(properties)
    .filter(
      ([, property]) => isPlainObject(property) && property[SYSTEM_ONLY_JSON_SCHEMA_KEY] === true,
    )
    .map(([name]) => name);
}

function withoutSystemOnlyProperties(
  jsonSchema: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const properties = jsonSchema["properties"];
  if (typeof properties !== "object" || properties === null) return jsonSchema;
  const hidden = systemOnlyPropertyNames(jsonSchema);
  if (hidden.length === 0) return jsonSchema;
  const required = jsonSchema["required"];
  return {
    ...jsonSchema,
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]) => !hidden.includes(name)),
    ),
    ...(Array.isArray(required) && { required: required.filter((name) => !hidden.includes(name)) }),
  };
}

/** `undefined` when the schema can't be expressed as JSON Schema (transforms,
 *  z.instanceof, ...) — such a handler is unusable for an agent tool call. */
export function handlerInputJsonSchema(
  def: QueryHandlerDef | WriteHandlerDef,
): Readonly<Record<string, unknown>> | undefined {
  try {
    return withoutSystemOnlyProperties(z.toJSONSchema(def.schema, { io: "input" }));
  } catch {
    return undefined;
  }
}

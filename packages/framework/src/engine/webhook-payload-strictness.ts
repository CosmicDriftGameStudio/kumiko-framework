import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { $ZodType } from "zod/v4/core";

// Zod defs are a wide union; the walker only needs the structural keys it names.
type LooseDef = {
  readonly type: string;
  readonly shape?: Readonly<Record<string, $ZodType>>;
  readonly catchall?: $ZodType;
  readonly element?: $ZodType;
  readonly innerType?: $ZodType;
  readonly options?: readonly $ZodType[];
  readonly items?: readonly $ZodType[];
  readonly rest?: $ZodType;
  readonly valueType?: $ZodType;
  readonly left?: $ZodType;
  readonly right?: $ZodType;
  readonly getter?: () => $ZodType;
  readonly in?: $ZodType;
  readonly out?: $ZodType;
};

function isLooseDef(def: unknown): def is LooseDef {
  return typeof def === "object" && def !== null && typeof propertyOf(def, "type") === "string";
}

function childSchemas(def: LooseDef, path: string): readonly (readonly [$ZodType, string])[] {
  const candidates: readonly (readonly [$ZodType | undefined, string])[] = [
    [def.element, `${path}[]`],
    [def.innerType, path],
    [def.rest, `${path}[]`],
    [def.in, path],
    [def.out, path],
    [def.valueType, `${path}[]`],
    [def.left, path],
    [def.right, path],
    [def.getter?.(), path],
    ...(def.options ?? []).map((option) => [option, path] as const),
    ...(def.items ?? []).map((item) => [item, path] as const),
  ];
  return candidates.flatMap(([child, childPath]) =>
    child === undefined ? [] : [[child, childPath] as const],
  );
}

function findInObject(def: LooseDef, path: string, visited: Set<$ZodType>): string | undefined {
  if (def.catchall !== undefined && def.catchall._zod.def.type !== "never") {
    return path === "" ? "(root)" : path;
  }
  for (const [key, child] of Object.entries(def.shape ?? {})) {
    const found = findOpenPayloadShape(child, path === "" ? key : `${path}.${key}`, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Path of the first object that would let undeclared keys through, else undefined.
 * Only open object shapes count: record/any/unknown are explicitly declared field types
 * carrying one named value, so they do not smuggle unknown keys of the row into the payload.
 */
export function findOpenPayloadShape(
  schema: $ZodType,
  path = "",
  visited: Set<$ZodType> = new Set(),
): string | undefined {
  // A lazy getter may point back at an ancestor; every schema is walked once.
  if (visited.has(schema)) return undefined;
  visited.add(schema);
  const def = schema._zod.def;
  if (!isLooseDef(def)) return undefined;
  if (def.type === "object") return findInObject(def, path, visited);
  for (const [child, childPath] of childSchemas(def, path)) {
    const found = findOpenPayloadShape(child, childPath, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

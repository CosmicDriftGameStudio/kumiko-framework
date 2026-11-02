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
  readonly in?: $ZodType;
  readonly out?: $ZodType;
};

/**
 * Path of the first object that would let undeclared keys through, else undefined.
 * Only open object shapes count: record/any/unknown are explicitly declared field types
 * carrying one named value, so they do not smuggle unknown keys of the row into the payload.
 */
export function findOpenPayloadShape(schema: $ZodType, path = ""): string | undefined {
  const def = schema._zod.def as LooseDef;
  const here = path === "" ? "(root)" : path;
  if (def.type === "object") {
    if (def.catchall !== undefined && def.catchall._zod.def.type !== "never") return here;
    for (const [key, child] of Object.entries(def.shape ?? {})) {
      const found = findOpenPayloadShape(child, path === "" ? key : `${path}.${key}`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const children: readonly (readonly [$ZodType | undefined, string])[] = [
    [def.element, `${path}[]`],
    [def.innerType, path],
    [def.rest, `${path}[]`],
    [def.in, path],
    [def.out, path],
    ...(def.options ?? []).map((option) => [option, path] as const),
    ...(def.items ?? []).map((item) => [item, path] as const),
  ];
  for (const [child, childPath] of children) {
    if (child === undefined) continue;
    const found = findOpenPayloadShape(child, childPath);
    if (found !== undefined) return found;
  }
  return undefined;
}

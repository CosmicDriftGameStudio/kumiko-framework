import type { FeatureDefinition } from "../types/index.ts";
import { buildQueryHandlerMap } from "./projection-list-screens.ts";
import { getZodRowShape } from "./zod-shape.ts";

// "opaque": the decoration query declares no introspectable outputSchema, so any field name may be a decoration field.
export type RowDecorationFields =
  | { readonly kind: "known"; readonly names: ReadonlySet<string> }
  | { readonly kind: "opaque" };

export function resolveRowDecorationFields(
  features: Iterable<FeatureDefinition>,
  rowDecoration: { readonly query: string } | undefined,
): RowDecorationFields | undefined {
  if (rowDecoration === undefined) return undefined;
  const handler = buildQueryHandlerMap([...features]).get(rowDecoration.query);
  const rowShape = getZodRowShape(handler?.outputSchema);
  return rowShape === undefined
    ? { kind: "opaque" }
    : { kind: "known", names: new Set(Object.keys(rowShape)) };
}

export function acceptsRowDecorationField(
  decoration: RowDecorationFields | undefined,
  field: string,
): boolean {
  if (decoration === undefined) return false;
  return decoration.kind === "opaque" || decoration.names.has(field);
}

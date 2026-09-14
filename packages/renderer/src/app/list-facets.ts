// Split from kumiko-screen.tsx: related-list-section.tsx renders through
// kumiko-screen.tsx, so importing this back from there would be a require cycle.

import type { ListFacetSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import type { DataTableFacet } from "../primitives";

// One resolved facet, independent of where the type info came from — an
// entity field (entityList) or an explicit ListFacetSpec (projectionList,
// relatedList, fw#2224). Shared by buildFilterFacets/buildFilterPayload below
// so all list-shaped screens build their query-payload filters and DataTable
// facet-UI through the same code, instead of copies that can drift.
export type ResolvedFacetSpec = {
  readonly field: string;
  readonly type: "select" | "boolean" | "reference";
  readonly label: string;
  /** Empty for a "reference" facet until `ReferenceFacetBridges` resolves it
   *  (fw akte-bedienkonzept-2 M1) — the referenced entity's rows are loaded
   *  at render time, unlike select/boolean's author-declared options. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** Present only for a "reference" facet — the resolved lookup target
   *  `ReferenceFacetBridges` needs to fetch its options. */
  readonly reference?: {
    readonly refEntity: string;
    readonly refFeature: string;
    readonly labelField: string;
  };
};

// Merges freshly-loaded reference-facet options (keyed by field, from
// ReferenceFacetBridges) into the resolved specs — the one seam where a
// "reference" spec's initially-empty `options` gets filled in, shared by
// every caller instead of each re-deriving the merge.
export function mergeReferenceFacetOptions(
  specs: readonly ResolvedFacetSpec[],
  optionsByField: Readonly<
    Record<string, readonly { readonly value: string; readonly label: string }[]>
  >,
): ResolvedFacetSpec[] {
  return specs.map((spec) =>
    spec.reference !== undefined
      ? { ...spec, options: optionsByField[spec.field] ?? spec.options }
      : spec,
  );
}

export function buildFilterFacets(specs: readonly ResolvedFacetSpec[]): DataTableFacet[] {
  return specs.map((spec) => ({ field: spec.field, label: spec.label, options: spec.options }));
}

// User-selected faceted filters from URL-state → payload.filters. Boolean
// fields coerce "true"/"false" strings to real booleans (DB column is
// boolean); everything else stays string[] under op:"in" (multi-select
// semantics). `typeOf` resolves a field to its known type string —
// undefined means "unknown field", so it's dropped (typo-safe: a stale/
// hand-crafted URL param for an undeclared field never reaches the
// server). Deliberately NOT gated on the field being a *facet* — entityList
// passes through any field present in entity.fields, matching its
// pre-fw#2224 behavior; only the boolean-coercion branch cares about type.

function isFacetI18nKey(label: string): boolean {
  return !/\s/.test(label) && (label.includes(".") || label.includes(":"));
}

export function buildFilterPayload(
  urlFilters: Readonly<Record<string, readonly string[]>>,
  typeOf: (field: string) => string | undefined,
): { field: string; op: "in"; value: unknown }[] {
  const out: { field: string; op: "in"; value: unknown }[] = [];
  for (const [field, values] of Object.entries(urlFilters)) {
    if (values.length === 0) continue;
    // `id` is a base column (not a declared facet), allowed as an id-set
    // filter so a header-slot control — e.g. the tags TagFilter — can narrow
    // ANY list to a resolved set of row ids without the host declaring a facet.
    if (field === "id") {
      out.push({ field, op: "in", value: values });
      continue;
    }
    const type = typeOf(field);
    if (type === undefined) continue;
    const value = type === "boolean" ? values.map((v) => v === "true") : values;
    out.push({ field, op: "in", value });
  }
  return out;
}

// projectionList/relatedList adapter — neither has an entity/i18n convention
// to derive labels from, so ListFacetSpec carries every label explicitly
// (fw#2224). Labels may be raw display strings or i18n keys; run them
// through translate like entity facets (passthrough when the key is missing).
// `featureName` resolves a reference facet's `entity` target the same way
// ListColumnSpec.refEntity does (same-feature short name, or "feature:entity").
export function resolveProjectionFacetSpecs(
  facets: readonly ListFacetSpec[] | undefined,
  translate: Translate,
  featureName: string,
): ResolvedFacetSpec[] {
  if (facets === undefined) return [];
  const tr = (label: string): string => (isFacetI18nKey(label) ? translate(label) : label);
  return facets.map((facet): ResolvedFacetSpec => {
    if (facet.type === "select") {
      return {
        field: facet.field,
        type: "select",
        label: tr(facet.label),
        options: facet.options.map((opt) => ({
          value: opt.value,
          label: tr(opt.label),
        })),
      };
    }
    if (facet.type === "boolean") {
      return {
        field: facet.field,
        type: "boolean",
        label: tr(facet.label),
        options: [
          { value: "true", label: tr(facet.trueLabel) },
          { value: "false", label: tr(facet.falseLabel) },
        ],
      };
    }
    const target = parseRefTarget(facet.entity, featureName);
    return {
      field: facet.field,
      type: "reference",
      label: tr(facet.label),
      options: [],
      reference: {
        refEntity: target.entityName,
        refFeature: target.featureName,
        labelField: facet.labelField ?? "id",
      },
    };
  });
}

// Split from kumiko-screen.tsx: related-list-section.tsx renders through
// kumiko-screen.tsx, so importing this back from there would be a require cycle.

import type { ListFacetSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "temporal-polyfill";
import type { DataTableFacet } from "../primitives";

// One resolved facet, independent of where the type info came from — an
// entity field (entityList) or an explicit ListFacetSpec (projectionList,
// relatedList). Shared by buildFilterFacets/buildFilterPayload so all list
// screens build filters and facet UI through one code path.
export type ResolvedFacetSpec = {
  readonly field: string;
  readonly type: "select" | "boolean" | "reference";
  readonly label: string;
  /** Empty for a "reference" facet until `ReferenceFacetBridges` resolves it
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

// Fills in a "reference" spec's initially-empty `options` from the
// field-keyed options ReferenceFacetBridges resolved, shared by every caller.
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
  // dateRange carries no option list and no `filters` entry — it resolves
  // through resolveDateRangeFacets into its own toolbar control instead.
  return facets.flatMap((facet): ResolvedFacetSpec[] => {
    if (facet.type === "dateRange") return [];
    if (facet.type === "select") {
      return [
        {
          field: facet.field,
          type: "select",
          label: tr(facet.label),
          options: facet.options.map((opt) => ({
            value: opt.value,
            label: tr(opt.label),
          })),
        },
      ];
    }
    if (facet.type === "boolean") {
      return [
        {
          field: facet.field,
          type: "boolean",
          label: tr(facet.label),
          options: [
            { value: "true", label: tr(facet.trueLabel) },
            { value: "false", label: tr(facet.falseLabel) },
          ],
        },
      ];
    }
    const target = parseRefTarget(facet.entity, featureName);
    return [
      {
        field: facet.field,
        type: "reference",
        label: tr(facet.label),
        options: [],
        reference: {
          refEntity: target.entityName,
          refFeature: target.featureName,
          labelField: facet.labelField ?? "id",
        },
      },
    ];
  });
}

// --- dateRange facet (fw#3104) ---

// A resolved dateRange facet. Kept out of ResolvedFacetSpec because it shares
// nothing with the option-dropdown facets: no options, no `filters` entry —
// the two bounds travel as named top-level query params.
export type ResolvedDateRangeFacet = {
  readonly field: string;
  readonly label: string;
  readonly fromParam: string;
  readonly toParam: string;
};

export type DateRangeBound = "from" | "to";

export type DateRangeValue = { readonly from: string; readonly to: string };

export function resolveDateRangeFacets(
  facets: readonly ListFacetSpec[] | undefined,
  translate: Translate,
): ResolvedDateRangeFacet[] {
  if (facets === undefined) return [];
  return facets.flatMap((facet): ResolvedDateRangeFacet[] =>
    facet.type === "dateRange"
      ? [
          {
            field: facet.field,
            label: isFacetI18nKey(facet.label) ? translate(facet.label) : facet.label,
            fromParam: facet.params.from,
            toParam: facet.params.to,
          },
        ]
      : [],
  );
}

// The bounds live in the same `<screenId>.f.<key>` URL namespace the option
// facets use, so setFilter's page-reset and clearFilters cover them for free.
// buildFilterPayload drops them again: a dotted key resolves to no facet
// type, which is its "unknown field" case.
export function dateRangeUrlField(field: string, bound: DateRangeBound): string {
  return `${field}.${bound}`;
}

export function readDateRange(
  urlFilters: Readonly<Record<string, readonly string[]>>,
  field: string,
): DateRangeValue {
  return {
    from: urlFilters[dateRangeUrlField(field, "from")]?.[0] ?? "",
    to: urlFilters[dateRangeUrlField(field, "to")]?.[0] ?? "",
  };
}

// Keeps from <= to by pushing the opposite bound along, so an inverted range
// can't reach the server and trip a handler's `from <= to` refine (a 422 the
// user would see as a broken list, not as a correction).
export function clampDateRange(
  current: DateRangeValue,
  bound: DateRangeBound,
  value: string,
): DateRangeValue {
  if (bound === "from") {
    const to = current.to !== "" && value !== "" && value > current.to ? value : current.to;
    return { from: value, to };
  }
  const from = current.from !== "" && value !== "" && value < current.from ? value : current.from;
  return { from, to: value };
}

// A calendar date covers a whole day in the viewer's zone: "from the 14th"
// starts at that day's first instant, "to the 14th" includes everything up to
// its last. Going through the next day's start keeps both ends right across a
// DST boundary, where the day is not 24h long.
function dayBoundInstant(date: string, bound: DateRangeBound, timeZone: string): string | null {
  let plainDate: Temporal.PlainDate;
  try {
    plainDate = Temporal.PlainDate.from(date);
  } catch {
    // Half-typed or hand-crafted URL value — drop the bound rather than send
    // something the handler's ISO-datetime schema would reject.
    return null;
  }
  const start = plainDate.toZonedDateTime(timeZone).toInstant();
  return bound === "from"
    ? start.toString()
    : plainDate
        .add({ days: 1 })
        .toZonedDateTime(timeZone)
        .toInstant()
        .subtract({
          nanoseconds: 1,
        })
        .toString();
}

export function buildDateRangePayload(
  specs: readonly ResolvedDateRangeFacet[],
  urlFilters: Readonly<Record<string, readonly string[]>>,
  timeZone: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const range = readDateRange(urlFilters, spec.field);
    for (const [bound, param] of [
      ["from", spec.fromParam],
      ["to", spec.toParam],
    ] as const) {
      const value = range[bound];
      if (value === "") continue;
      const instant = dayBoundInstant(value, bound, timeZone);
      if (instant !== null) out[param] = instant;
    }
  }
  return out;
}

import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { useCallback, useMemo } from "react";
import type { DataTableRangeBound, DataTableRangeFacet } from "../data-table-aggregate-types.ts";
import { fieldLabelKey, type Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";

const RANGE_FIELD_TYPES: ReadonlySet<string> = new Set(["number", "decimal", "money", "bigInt"]);

// Money is stored and filtered in minor units; the user types the major amount.
const MONEY_MINOR_UNITS = 100;

type RangeFacetSpec = {
  readonly field: string;
  readonly label: string;
  readonly money: boolean;
  readonly unit?: string;
};

export type RangeFilter = {
  readonly field: string;
  readonly op: "gte" | "lte";
  readonly value: number;
};

// The bounds live in the facet URL namespace (`<screenId>.f.<field>.min`), so
// page reset and clearFilters cover them; buildFilterPayload skips the dotted key.
function rangeUrlField(field: string, bound: DataTableRangeBound): string {
  return `${field}.${bound}`;
}

function literalCurrencyOf(def: unknown): string | undefined {
  const currency = propertyOf(def, "currency");
  const code = propertyOf(currency, "code");
  return propertyOf(currency, "kind") === "literal" && typeof code === "string" ? code : undefined;
}

function resolveRangeSpecs(
  fields: Readonly<Record<string, unknown>>,
  facets: EntityListScreenDefinition["facets"],
  featureName: string,
  entityName: string,
  translate: Translate,
): RangeFacetSpec[] {
  return Object.entries(facets ?? {}).flatMap(([field, config]): RangeFacetSpec[] => {
    if (config === false || config.display !== "range") return [];
    const def = fields[field];
    const type = propertyOf(def, "type");
    if (typeof type !== "string" || !RANGE_FIELD_TYPES.has(type)) return [];
    const unit = type === "money" ? literalCurrencyOf(def) : undefined;
    return [
      {
        field,
        label: translate(fieldLabelKey(featureName, entityName, field)),
        money: type === "money",
        ...(unit !== undefined && { unit }),
      },
    ];
  });
}

function boundOf(
  urlFilters: Readonly<Record<string, readonly string[]>>,
  field: string,
  bound: DataTableRangeBound,
): string {
  return urlFilters[rangeUrlField(field, bound)]?.[0] ?? "";
}

function rangeFiltersOf(
  specs: readonly RangeFacetSpec[],
  urlFilters: Readonly<Record<string, readonly string[]>>,
): RangeFilter[] {
  return specs.flatMap((spec) =>
    (["min", "max"] as const).flatMap((bound): RangeFilter[] => {
      const typed = boundOf(urlFilters, spec.field, bound);
      const amount = Number(typed);
      if (typed === "" || !Number.isFinite(amount)) return [];
      const value = spec.money ? Math.round(amount * MONEY_MINOR_UNITS) : amount;
      return [{ field: spec.field, op: bound === "min" ? "gte" : "lte", value }];
    }),
  );
}

export type EntityRangeFacets = {
  readonly rangeFacets: readonly DataTableRangeFacet[];
  readonly rangeFilters: readonly RangeFilter[];
  /** Facet keys the remembered list state may keep (`<field>`, bounds hang off it). */
  readonly rangeFields: readonly string[];
  readonly onRangeChange: (field: string, bound: DataTableRangeBound, value: string) => void;
};

/** `display: "range"` facets of an entityList: from/to inputs sent as `gte`/`lte`. */
export function useEntityRangeFacets({
  fields,
  screen,
  featureName,
  translate,
  urlState,
}: {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly screen: EntityListScreenDefinition;
  readonly featureName: string;
  readonly translate: Translate;
  readonly urlState: Pick<ListUrlStateApi, "filters" | "setFilter">;
}): EntityRangeFacets {
  const { filters: urlFilters, setFilter } = urlState;
  const specs = useMemo(
    () => resolveRangeSpecs(fields, screen.facets, featureName, screen.entity, translate),
    [fields, screen.facets, featureName, screen.entity, translate],
  );
  const rangeFacets = useMemo(
    () =>
      specs.map((spec) => ({
        field: spec.field,
        label: spec.label,
        min: boundOf(urlFilters, spec.field, "min"),
        max: boundOf(urlFilters, spec.field, "max"),
        ...(spec.unit !== undefined && { unit: spec.unit }),
      })),
    [specs, urlFilters],
  );
  const rangeFilters = useMemo(() => rangeFiltersOf(specs, urlFilters), [specs, urlFilters]);
  const rangeFields = useMemo(() => specs.map((spec) => spec.field), [specs]);
  const onRangeChange = useCallback(
    (field: string, bound: DataTableRangeBound, value: string) =>
      setFilter(rangeUrlField(field, bound), value === "" ? [] : [value]),
    [setFilter],
  );
  return { rangeFacets, rangeFilters, rangeFields, onRangeChange };
}

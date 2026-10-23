import { UNRESOLVED_REFERENCE_LABEL_KEYS } from "@cosmicdrift/kumiko-framework/ui-types";
import type { useReferenceLinkResolver } from "../app/reference-link.ts";
import type {
  CellLinkItem,
  ListColumnViewModel,
  RuntimeCellLink,
  RuntimeCellLinkItems,
  RuntimeRenderer,
  Translate,
} from "../headless/index.ts";
import { EMPTY_VALUE_PLACEHOLDER } from "../headless/index.ts";
import type { ReferenceLookupMap } from "../hooks/use-reference-lookup.ts";

export type PublishedReferenceLookup = {
  readonly map: ReferenceLookupMap;
  readonly complete: boolean;
};

export type ReferenceColumnSpec = {
  readonly field: string;
  readonly refEntity: string;
  readonly refFeature: string;
  readonly labelField: string;
};

type ResolveReferenceLink = ReturnType<typeof useReferenceLinkResolver>;

type EagerloadedRef = Record<string, unknown> | readonly Record<string, unknown>[] | undefined;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The server leaves a missing or unreadable target out of `_refs`, and a null
// entry means the same: both read as unresolved.
function eagerloadedRef(row: unknown, field: string): EagerloadedRef {
  // skip: row carries no eager-loaded refs, so the lookup map decides
  if (!isPlainRecord(row) || !isPlainRecord(row["_refs"])) return undefined;
  const ref = row["_refs"][field];
  if (Array.isArray(ref)) return ref.filter(isPlainRecord);
  return isPlainRecord(ref) ? ref : undefined;
}

export function selectReferenceColumns(
  columns: readonly ListColumnViewModel[],
  featureName: string,
): ReferenceColumnSpec[] {
  return columns
    .filter((c: ListColumnViewModel) => c.type === "reference" && c.refEntity !== undefined)
    .map((c: ListColumnViewModel) => ({
      field: c.field,
      refEntity: c.refEntity ?? "",
      // refFeature comes from parseRefTarget in the ViewModel
      // (default = the current featureName).
      refFeature: c.refFeature ?? featureName,
      labelField: c.refLabelField ?? "id",
    }));
}

type ColumnLookup = {
  readonly col: ListColumnViewModel;
  readonly map: ReferenceLookupMap | undefined;
  readonly refEntity: string;
  readonly labelField: string;
  readonly resolveReferenceLink: ResolveReferenceLink;
  readonly unresolvedLabel: (id: string) => string;
};

// No raw id for entities that opt in: a placeholder while the lookup
// loads, the "unknown" label once the complete lookup found nothing. A
// capped lookup page cannot prove absence, so it keeps the raw id.
function unresolvedLabelFor(
  unknownKey: string | undefined,
  published: PublishedReferenceLookup | undefined,
  translate: Translate,
): (id: string) => string {
  return (id: string): string =>
    unknownKey === undefined
      ? id
      : published === undefined
        ? EMPTY_VALUE_PLACEHOLDER
        : published.complete
          ? translate(unknownKey)
          : id;
}

// Only a row the user can see is linkable: resolved by the server
// eagerload or by the lookup query. A multi-reference links per entry via linkItemsFor.
function buildLinkFor(lookup: ColumnLookup): RuntimeCellLink {
  const { col, map, refEntity, resolveReferenceLink } = lookup;
  return (value, row) => {
    // skip: empty and multi-valued cells have no single target to link
    if (value === null || value === undefined || value === "" || Array.isArray(value)) {
      return undefined;
    }
    const id = String(value);
    const eagerloaded = eagerloadedRef(row, col.field);
    // The server leaves a missing or unreadable target out; null is treated the same.
    const resolved =
      (typeof eagerloaded === "object" && eagerloaded !== null && !Array.isArray(eagerloaded)) ||
      map?.has(id);
    return resolved === true ? resolveReferenceLink(refEntity, id) : undefined;
  };
}

function buildLinkItemsFor(lookup: ColumnLookup): RuntimeCellLinkItems {
  const { col, map, refEntity, labelField, resolveReferenceLink, unresolvedLabel } = lookup;
  return (value, row) => {
    // skip: only a non-empty array is a multi-reference value
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const eagerloaded = eagerloadedRef(row, col.field);
    const eagerById = new Map<string, Record<string, unknown>>(
      Array.isArray(eagerloaded) ? eagerloaded.map((r) => [String(r["id"]), r]) : [],
    );
    return value.map((v): CellLinkItem => {
      const id = String(v);
      const target = eagerById.get(id);
      const label = String(target?.[labelField] ?? map?.get(id) ?? unresolvedLabel(id));
      // Only a row the user can see is linkable: server eagerload or lookup query.
      const link =
        target !== undefined || map?.has(id) === true
          ? resolveReferenceLink(refEntity, id)
          : undefined;
      return { id, label, ...(link !== undefined && { link }) };
    });
  };
}

function buildReferenceRenderer(lookup: ColumnLookup): RuntimeRenderer {
  const { col, map, labelField, unresolvedLabel } = lookup;
  return (value: unknown, row?: Readonly<Record<string, unknown>>): string => {
    // Server eager loading: when the server includes _refs, read the display
    // value directly from the resolved row. This avoids a round trip
    // through the bridge map and the limit:200 constraint. The
    // EagerloadedRow type from @cosmicdrift/kumiko-framework/db defines
    // the shape of _refs.
    const resolved = eagerloadedRef(row, col.field);
    if (Array.isArray(resolved) && resolved.length > 0) {
      return resolved.map((r) => String(r[labelField] ?? r["id"] ?? "")).join(", ");
    }
    if (isPlainRecord(resolved)) {
      return String(resolved[labelField] ?? resolved["id"] ?? "");
    }
    // Renderer-side fallback when server eager loading is not active.
    if (Array.isArray(value)) {
      if (value.length === 0) return EMPTY_VALUE_PLACEHOLDER;
      return value.map((v) => map?.get(String(v)) ?? unresolvedLabel(String(v))).join(", ");
    }
    if (value === null || value === undefined || value === "") return EMPTY_VALUE_PLACEHOLDER;
    const idStr = String(value);
    return map?.get(idStr) ?? unresolvedLabel(idStr);
  };
}

export type EnrichReferenceColumnsInput = {
  readonly columns: readonly ListColumnViewModel[];
  readonly referenceColumns: readonly ReferenceColumnSpec[];
  readonly referenceLookups: Readonly<Record<string, PublishedReferenceLookup>>;
  readonly resolveReferenceLink: ResolveReferenceLink;
  readonly featureName: string;
  readonly translate: Translate;
};

function enrichReferenceColumn(
  col: ListColumnViewModel,
  input: EnrichReferenceColumnsInput,
): ListColumnViewModel {
  const { referenceLookups, resolveReferenceLink, featureName, translate } = input;
  // skip: only reference columns are enriched
  if (col.type !== "reference") return col;
  // skip: an author-declared renderer always takes precedence; the default
  // is used only when none is set.
  if (col.renderer !== undefined) return col;
  const published = referenceLookups[col.field];
  const unknownKey =
    UNRESOLVED_REFERENCE_LABEL_KEYS[`${col.refFeature ?? featureName}:${col.refEntity ?? ""}`];
  const lookup: ColumnLookup = {
    col,
    map: published?.map,
    refEntity: col.refEntity ?? "",
    labelField: col.refLabelField ?? "id",
    resolveReferenceLink,
    unresolvedLabel: unresolvedLabelFor(unknownKey, published, translate),
  };
  return {
    ...col,
    renderer: buildReferenceRenderer(lookup),
    linkFor: buildLinkFor(lookup),
    linkItemsFor: buildLinkItemsFor(lookup),
  };
}

export function enrichReferenceColumns(
  input: EnrichReferenceColumnsInput,
): readonly ListColumnViewModel[] {
  const { columns, referenceColumns } = input;
  // skip: without reference columns the view-model columns pass through untouched
  if (referenceColumns.length === 0) return columns;
  return columns.map((col: ListColumnViewModel) => enrichReferenceColumn(col, input));
}

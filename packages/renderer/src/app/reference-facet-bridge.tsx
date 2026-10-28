// One bridge component per reference facet, mirroring ReferenceLookupBridge —
// facet count varies per screen, so the hook can't be called in a loop.

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits.ts";
import { useQuery } from "../hooks/use-query.ts";
import {
  referenceOptionSource,
  storedReferenceRowsPayload,
  withUnlistedSelectedRows,
} from "../hooks/use-reference-lookup.ts";
import type { ResolvedFacetSpec } from "./list-facets.ts";

export type ReferenceFacetOption = { readonly value: string; readonly label: string };

/** What a bridge publishes for its facet: the options for the current search term plus the
 *  handle that changes the term. */
export type ReferenceFacetState = {
  readonly options: readonly ReferenceFacetOption[];
  readonly onSearchChange: (query: string) => void;
  readonly searching: boolean;
};

/** Reducer step for the callers' state: same state keeps the previous object, so an unchanged
 *  bridge does not re-render the list. */
export function withReferenceFacetState(
  previous: Readonly<Record<string, ReferenceFacetState>>,
  field: string,
  state: ReferenceFacetState,
): Readonly<Record<string, ReferenceFacetState>> {
  const before = previous[field];
  const unchanged =
    before?.options === state.options &&
    before.searching === state.searching &&
    before.onSearchChange === state.onSearchChange;
  return unchanged ? previous : { ...previous, [field]: state };
}

type ReferenceRows = { rows: ReadonlyArray<Record<string, unknown>> };

function ReferenceFacetOptionsBridge({
  field,
  refEntity,
  refFeature,
  labelField,
  optionsQuery,
  selected,
  onState,
}: {
  readonly field: string;
  readonly refEntity: string;
  readonly refFeature: string;
  readonly labelField: string;
  readonly optionsQuery: string | undefined;
  readonly selected: readonly string[];
  readonly onState: (field: string, state: ReferenceFacetState) => void;
}): ReactNode {
  const { queryQn, labelKey } = referenceOptionSource(
    {
      refLabelField: labelField,
      ...(optionsQuery !== undefined && { refOptionsQuery: optionsQuery }),
    },
    refFeature,
    refEntity,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const payload = useMemo(
    () =>
      searchTerm === ""
        ? { limit: REFERENCE_COMBOBOX_LIMIT }
        : { limit: REFERENCE_COMBOBOX_LIMIT, search: searchTerm },
    [searchTerm],
  );
  const listed = useQuery<ReferenceRows>(queryQn, payload);
  // The first page can miss a chosen value; without its row the chip would show the raw id.
  const chosen = useQuery<ReferenceRows>(
    queryQn,
    storedReferenceRowsPayload(
      optionsQuery !== undefined ? { refOptionsQuery: optionsQuery } : {},
      selected,
      REFERENCE_COMBOBOX_LIMIT,
    ),
    { enabled: selected.length > 0 },
  );
  const onSearchChange = useCallback((query: string) => setSearchTerm(query), []);
  const options = useMemo(
    () =>
      withUnlistedSelectedRows(listed.data?.rows ?? [], chosen.data?.rows ?? []).map((row) => {
        const value = String(row["id"] ?? "");
        return { value, label: String(row[labelKey] ?? value) };
      }),
    [listed.data, chosen.data, labelKey],
  );
  const searching = listed.loading;
  useEffect(() => {
    onState(field, { options, onSearchChange, searching });
  }, [field, options, onSearchChange, searching, onState]);
  return null;
}

// One invisible bridge per "reference" facet spec, each publishing its
// resolved options back via `onState` once loaded.
export function ReferenceFacetBridges({
  specs,
  selected,
  onState,
}: {
  readonly specs: readonly ResolvedFacetSpec[];
  /** The facet selections of the list (field to chosen ids), so chosen values keep their label. */
  readonly selected: Readonly<Record<string, readonly string[]>>;
  readonly onState: (field: string, state: ReferenceFacetState) => void;
}): ReactNode {
  const referenceSpecs = specs.filter((spec) => spec.reference !== undefined);
  if (referenceSpecs.length === 0) return null;
  return (
    <>
      {referenceSpecs.map((spec) => (
        <ReferenceFacetOptionsBridge
          key={spec.field}
          field={spec.field}
          refEntity={spec.reference?.refEntity ?? ""}
          refFeature={spec.reference?.refFeature ?? ""}
          labelField={spec.reference?.labelField ?? "id"}
          optionsQuery={spec.reference?.optionsQuery}
          selected={selected[spec.field] ?? NO_SELECTION}
          onState={onState}
        />
      ))}
    </>
  );
}

const NO_SELECTION: readonly string[] = [];

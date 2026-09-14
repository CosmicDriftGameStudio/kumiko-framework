// One bridge component per reference facet, mirroring ReferenceLookupBridge —
// facet count varies per screen, so the hook can't be called in a loop.
import { type ReactNode, useEffect } from "react";
import { useReferenceLookup } from "../hooks/use-reference-lookup";
import type { ResolvedFacetSpec } from "./list-facets";

export type ReferenceFacetOption = { readonly value: string; readonly label: string };

function ReferenceFacetOptionsBridge({
  field,
  refEntity,
  refFeature,
  labelField,
  onOptions,
}: {
  readonly field: string;
  readonly refEntity: string;
  readonly refFeature: string;
  readonly labelField: string;
  readonly onOptions: (field: string, options: readonly ReferenceFacetOption[]) => void;
}): ReactNode {
  const lookup = useReferenceLookup(refFeature, refEntity, labelField);
  useEffect(() => {
    if (lookup.loading) return;
    onOptions(
      field,
      [...lookup.map.entries()].map(([value, label]) => ({ value, label })),
    );
  }, [lookup.loading, lookup.map, field, onOptions]);
  return null;
}

// One invisible bridge per "reference" facet spec, each publishing its
// resolved options back via `onOptions` once loaded.
export function ReferenceFacetBridges({
  specs,
  onOptions,
}: {
  readonly specs: readonly ResolvedFacetSpec[];
  readonly onOptions: (field: string, options: readonly ReferenceFacetOption[]) => void;
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
          onOptions={onOptions}
        />
      ))}
    </>
  );
}

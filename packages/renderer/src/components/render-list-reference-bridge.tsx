import type { ReactNode } from "react";
import { useEffect } from "react";
import { useReferenceLookup } from "../hooks/use-reference-lookup.ts";
import type {
  PublishedReferenceLookup,
  ReferenceColumnSpec,
} from "./render-list-reference-columns.ts";

// Bridge component for each reference column. It is mounted once per
// column, calls useReferenceLookup unconditionally, and publishes the map
// to the parent through onMap. React manages mounting and unmounting when
// the schema changes through the key prop in the parent's map loop.
function ReferenceLookupBridge({
  field,
  refEntity,
  labelField,
  featureName,
  onMap,
}: {
  readonly field: string;
  readonly refEntity: string;
  readonly labelField: string;
  readonly featureName: string;
  readonly onMap: (field: string, lookup: PublishedReferenceLookup) => void;
}): null {
  const lookup = useReferenceLookup(featureName, refEntity, labelField);
  // Use an effect rather than calling directly so setState runs outside the
  // render path; otherwise React warns about updating one component while
  // rendering another.
  // Do not publish while loading or after a failed lookup: a missing map means
  // "not resolved", whereas an empty published map means "nothing found".
  // Only the latter may display "Unknown".
  const resolved = !lookup.loading && !lookup.failed;
  useEffect(() => {
    if (resolved) onMap(field, { map: lookup.map, complete: lookup.complete });
  }, [field, lookup.map, lookup.complete, resolved, onMap]);
  return null;
}

export function renderReferenceLookupBridges(
  referenceColumns: readonly ReferenceColumnSpec[],
  onMap: (field: string, lookup: PublishedReferenceLookup) => void,
): ReactNode {
  return referenceColumns.map((rc: ReferenceColumnSpec) => (
    <ReferenceLookupBridge
      key={rc.field}
      field={rc.field}
      refEntity={rc.refEntity}
      labelField={rc.labelField}
      featureName={rc.refFeature}
      onMap={onMap}
    />
  ));
}

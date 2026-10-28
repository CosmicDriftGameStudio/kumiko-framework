import type { ReactNode } from "react";
import { useEffect } from "react";
import { useReferenceLookup } from "../hooks/use-reference-lookup.ts";
import type {
  PublishedReferenceLookup,
  ReferenceLookupRequest,
} from "./render-list-reference-columns.ts";

// Bridge component for each reference column. It is mounted once per
// column, calls useReferenceLookup unconditionally, and publishes the map
// to the parent through onMap. React manages mounting and unmounting when
// the schema changes through the key prop in the parent's map loop.
function ReferenceLookupBridge({
  field,
  chunkIndex,
  ids,
  refEntity,
  labelField,
  featureName,
  onMap,
}: {
  readonly field: string;
  readonly chunkIndex: number;
  readonly ids: readonly string[];
  readonly refEntity: string;
  readonly labelField: string;
  readonly featureName: string;
  readonly onMap: ReferenceChunkPublisher;
}): null {
  const lookup = useReferenceLookup(featureName, refEntity, labelField, ids);
  // Use an effect rather than calling directly so setState runs outside the
  // render path; otherwise React warns about updating one component while
  // rendering another.
  // Do not publish while loading or after a failed lookup: a missing map means
  // "not resolved", whereas an empty published map means "nothing found".
  // Only the latter may display "Unknown".
  const resolved = !lookup.loading && !lookup.failed;
  useEffect(() => {
    if (resolved) onMap(field, chunkIndex, { map: lookup.map, complete: lookup.complete });
  }, [field, chunkIndex, lookup.map, lookup.complete, resolved, onMap]);
  return null;
}

export type ReferenceChunkPublisher = (
  field: string,
  chunkIndex: number,
  lookup: PublishedReferenceLookup,
) => void;

export function renderReferenceLookupBridges(
  referenceRequests: readonly ReferenceLookupRequest[],
  onMap: ReferenceChunkPublisher,
): ReactNode {
  return referenceRequests.flatMap((request) =>
    request.idChunks.map((ids, chunkIndex) => (
      <ReferenceLookupBridge
        key={`${request.field}:${ids[0] ?? ""}`}
        field={request.field}
        chunkIndex={chunkIndex}
        ids={ids}
        refEntity={request.refEntity}
        labelField={request.labelField}
        featureName={request.refFeature}
        onMap={onMap}
      />
    )),
  );
}

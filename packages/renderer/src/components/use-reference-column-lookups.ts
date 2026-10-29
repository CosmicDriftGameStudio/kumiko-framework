import { useCallback, useMemo, useState } from "react";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "../hooks/reference-limits.ts";
import {
  mergeChunkLookups,
  type PublishedReferenceChunk,
  type PublishedReferenceLookup,
  type ReferenceColumnSpec,
  type ReferenceLookupRequest,
  referenceIdChunks,
} from "./render-list-reference-columns.ts";

// Bridge components (renderReferenceLookupBridges) publish each id chunk's
// lookup through handleLookupMap; the merged result feeds enrichReferenceColumns.
export function useReferenceColumnLookups(
  rows: readonly Readonly<Record<string, unknown>>[],
  referenceColumns: readonly ReferenceColumnSpec[],
) {
  const referenceRequests = useMemo(
    (): readonly ReferenceLookupRequest[] =>
      referenceColumns.map((column) => ({
        ...column,
        idChunks: referenceIdChunks(rows, column.field, REFERENCE_LIST_LOOKUP_LIMIT),
      })),
    [referenceColumns, rows],
  );
  const [chunkLookups, setChunkLookups] = useState<
    Record<string, Readonly<Record<number, PublishedReferenceChunk>>>
  >({});
  const handleLookupMap = useCallback(
    (field: string, chunkIndex: number, lookup: PublishedReferenceChunk) => {
      setChunkLookups((prev) => {
        // Skip the update when the lookup is identical. Otherwise the bridge
        // would re-render and send the same map back until React entered
        // an infinite loop.
        const current = prev[field]?.[chunkIndex];
        const unchanged =
          current?.map === lookup.map &&
          current.complete === lookup.complete &&
          current.idsKey === lookup.idsKey;
        if (unchanged) return prev;
        return { ...prev, [field]: { ...prev[field], [chunkIndex]: lookup } };
      });
    },
    [],
  );
  const referenceLookups = useMemo(() => {
    const merged: Record<string, PublishedReferenceLookup> = {};
    for (const request of referenceRequests) {
      const lookup = mergeChunkLookups(request.idChunks, chunkLookups[request.field]);
      if (lookup !== undefined) merged[request.field] = lookup;
    }
    return merged;
  }, [referenceRequests, chunkLookups]);
  return { referenceRequests, handleLookupMap, referenceLookups };
}

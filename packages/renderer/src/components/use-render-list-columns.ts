import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import {
  type ScreenLinkResolver,
  useReferenceLinkResolver,
  useScreenLinkResolver,
} from "../app/reference-link.ts";
import type { ListColumnViewModel, ListViewModel, Translate } from "../headless/index.ts";
import { computeListViewModel } from "../headless/index.ts";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "../hooks/reference-limits.ts";
import {
  enrichReferenceColumns,
  mergeChunkLookups,
  type PublishedReferenceChunk,
  type PublishedReferenceLookup,
  type ReferenceLookupRequest,
  referenceIdChunks,
  selectReferenceColumns,
} from "./render-list-reference-columns.ts";

// A column whose rows name their own target screen links each cell there.
export function withScreenLinks(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
  resolveScreenLink: ScreenLinkResolver,
): readonly ListColumnViewModel[] {
  const linkFields = new Map<string, string>();
  for (const spec of screen.columns) {
    const normalized = normalizeListColumn(spec);
    if (normalized.linkScreenField !== undefined) {
      linkFields.set(normalized.field, normalized.linkScreenField);
    }
  }
  if (linkFields.size === 0) return columns;
  return columns.map((col) => {
    const linkScreenField = linkFields.get(col.field);
    if (linkScreenField === undefined) return col;
    return {
      ...col,
      linkFor: (_value, row) => {
        const screenQn = row?.[linkScreenField];
        return typeof screenQn === "string" ? resolveScreenLink(screenQn) : undefined;
      },
    };
  });
}

type RenderListColumnsInput = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: Pick<EntityDefinition, "fields" | "derivedFields">;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly featureName: string;
  readonly translate: Translate;
};

export function useRenderListColumns(input: RenderListColumnsInput) {
  const { screen, entity, rows, featureName, translate } = input;
  const vm = useMemo(
    () => computeListViewModel({ screen, entity, rows, translate, featureName }),
    [screen, entity, rows, translate, featureName],
  );

  // Reference-field eager loading through bridge components.
  // The Hooks rule requires useReferenceLookup for each reference column,
  // but the number of columns varies with the schema. Each column therefore
  // mounts a ReferenceLookupBridge that publishes its map to local state
  // through onMap. Each bridge makes a constant number of hook calls (one),
  // and React manages its lifecycle when the schema changes via key.
  const referenceColumns = useMemo(
    () => selectReferenceColumns(vm.columns, featureName),
    [vm.columns, featureName],
  );
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
  const resolveReferenceLink = useReferenceLinkResolver();
  const resolveScreenLink = useScreenLinkResolver();
  const enrichedColumns = useMemo(
    (): readonly ListColumnViewModel[] =>
      withScreenLinks(
        enrichReferenceColumns({
          columns: vm.columns,
          referenceColumns,
          referenceLookups,
          resolveReferenceLink,
          featureName,
          translate,
        }),
        screen,
        resolveScreenLink,
      ),
    [
      vm.columns,
      referenceColumns,
      referenceLookups,
      resolveReferenceLink,
      resolveScreenLink,
      screen,
      featureName,
      translate,
    ],
  );
  const enrichedVm = useMemo(
    (): Omit<ListViewModel, "columns"> & { columns: readonly ListColumnViewModel[] } => ({
      ...vm,
      columns: enrichedColumns,
    }),
    [vm, enrichedColumns],
  );
  return { referenceRequests, handleLookupMap, enrichedVm };
}

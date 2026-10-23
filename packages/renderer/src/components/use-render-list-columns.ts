import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import { useReferenceLinkResolver } from "../app/reference-link.ts";
import type { ListColumnViewModel, ListViewModel, Translate } from "../headless/index.ts";
import { computeListViewModel } from "../headless/index.ts";
import {
  enrichReferenceColumns,
  type PublishedReferenceLookup,
  selectReferenceColumns,
} from "./render-list-reference-columns.ts";

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
  const [referenceLookups, setReferenceLookups] = useState<
    Record<string, PublishedReferenceLookup>
  >({});
  const handleLookupMap = useCallback((field: string, lookup: PublishedReferenceLookup) => {
    setReferenceLookups((prev) => {
      // Skip the update when the lookup is identical. Otherwise the bridge
      // would re-render and send the same map back until React entered
      // an infinite loop.
      const current = prev[field];
      if (current?.map === lookup.map && current.complete === lookup.complete) return prev;
      return { ...prev, [field]: lookup };
    });
  }, []);
  const resolveReferenceLink = useReferenceLinkResolver();
  const enrichedColumns = useMemo(
    (): readonly ListColumnViewModel[] =>
      enrichReferenceColumns({
        columns: vm.columns,
        referenceColumns,
        referenceLookups,
        resolveReferenceLink,
        featureName,
        translate,
      }),
    [vm.columns, referenceColumns, referenceLookups, resolveReferenceLink, featureName, translate],
  );
  const enrichedVm = useMemo(
    (): Omit<ListViewModel, "columns"> & { columns: readonly ListColumnViewModel[] } => ({
      ...vm,
      columns: enrichedColumns,
    }),
    [vm, enrichedColumns],
  );
  return { referenceColumns, handleLookupMap, enrichedVm };
}

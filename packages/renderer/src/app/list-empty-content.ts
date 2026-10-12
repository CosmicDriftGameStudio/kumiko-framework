import type { ListEmptyStateSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { useMemo } from "react";
import type { ListEmptyStateContent } from "../components/list-empty-state.js";
import { buildRecordActions } from "./row-actions.js";

type ActionBindings = Pick<
  Parameters<typeof buildRecordActions>[0],
  "nav" | "host" | "dispatcher" | "openDrawer" | "onWriteSuccess"
>;

const NO_RECORD: Readonly<Record<string, unknown>> = {};

// An empty list has no row, so the action is resolved against an empty record.
export function useListEmptyContent(
  spec: ListEmptyStateSpec | undefined,
  translate: Translate,
  bindings: ActionBindings,
): ListEmptyStateContent | undefined {
  const { nav, host, dispatcher, openDrawer, onWriteSuccess } = bindings;
  return useMemo(() => {
    if (spec === undefined) return undefined;
    const action =
      spec.action === undefined
        ? undefined
        : buildRecordActions({
            actions: [spec.action],
            record: NO_RECORD,
            translate,
            nav,
            host,
            dispatcher,
            openDrawer,
            onWriteSuccess,
          })?.[0];
    return {
      title: translate(spec.title),
      ...(spec.description !== undefined && { description: translate(spec.description) }),
      ...(action !== undefined && { action }),
    };
  }, [spec, translate, nav, host, dispatcher, openDrawer, onWriteSuccess]);
}

// Facets with a default are only "narrowed" once the user moved off that default.
export function isListNarrowed(
  search: string,
  filters: Readonly<Record<string, readonly string[]>>,
  defaultFilters: Readonly<Record<string, readonly string[]>> = {},
): boolean {
  if (search.trim() !== "") return true;
  const fields = new Set([...Object.keys(filters), ...Object.keys(defaultFilters)]);
  for (const field of fields) {
    const current = filters[field] ?? [];
    const baseline = defaultFilters[field] ?? [];
    if (current.length !== baseline.length || current.some((v) => !baseline.includes(v))) {
      return true;
    }
  }
  return false;
}

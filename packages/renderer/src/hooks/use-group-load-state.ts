import { useCallback, useState } from "react";
import type { ListGroupPageResult } from "./list-group-pages.ts";
import { freshLoadState, type GroupLoadState } from "./list-server-groups.ts";

function withToggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

export type GroupLoadControls = {
  readonly state: GroupLoadState;
  readonly onToggle: (key: string) => void;
  readonly onHeaderVisible: (key: string) => void;
  readonly onLoadMore: (key: string) => void;
  readonly onResult: (pageKey: string, result: ListGroupPageResult) => void;
};

/** Open/visible/paged state of the server groups; starts over when `resetKey` changes. */
export function useGroupLoadState(resetKey: string): GroupLoadControls {
  const [loadState, setLoadState] = useState(() => freshLoadState(resetKey));
  const state = loadState.resetKey === resetKey ? loadState : freshLoadState(resetKey);
  if (loadState.resetKey !== resetKey) setLoadState(state);

  const update = useCallback(
    (change: (current: GroupLoadState) => GroupLoadState) =>
      setLoadState((current) => (current.resetKey === resetKey ? change(current) : current)),
    [resetKey],
  );
  const onToggle = useCallback(
    (key: string) =>
      update((current) => ({ ...current, toggled: withToggled(current.toggled, key) })),
    [update],
  );
  const onHeaderVisible = useCallback(
    (key: string) =>
      update((current) =>
        current.visible.has(key)
          ? current
          : { ...current, visible: new Set([...current.visible, key]) },
      ),
    [update],
  );
  const onLoadMore = useCallback(
    (key: string) =>
      update((current) => {
        const requestedPages = new Map(current.requestedPages);
        requestedPages.set(key, (current.requestedPages.get(key) ?? 1) + 1);
        return { ...current, requestedPages };
      }),
    [update],
  );
  const onResult = useCallback(
    (pageKey: string, result: ListGroupPageResult) =>
      update((current) => {
        const results = new Map(current.results);
        results.set(pageKey, result);
        return { ...current, results };
      }),
    [update],
  );
  return { state, onToggle, onHeaderVisible, onLoadMore, onResult };
}

import { useEffect, useMemo, useRef } from "react";
import { useNav } from "../app/nav.tsx";
import type { ListStateStore } from "../components/list-state-store.tsx";
import { listParamKeys } from "./list-reset.ts";
import { type KnownListFields, sanitizeStoredListState } from "./list-state-schema.ts";

type Phase = "pending" | "restoring" | "live";

type RememberedListParamsArgs = {
  readonly screenId: string;
  readonly enabled: boolean;
  readonly store: ListStateStore;
  readonly known: KnownListFields;
};

function stripScreenPrefix(
  params: Readonly<Record<string, string>>,
  screenId: string,
): Record<string, string> {
  const prefix = `${screenId}.`;
  return Object.fromEntries(
    listParamKeys(params, screenId).flatMap((key) => {
      const value = params[key];
      return value === undefined ? [] : [[key.slice(prefix.length), value] as const];
    }),
  );
}

function sameParams(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** URL stays the source of truth: the stored list params are copied into the
 *  URL once when the screen opens without any, and every later URL change is
 *  written back. A link that already carries list params is never overridden. */
export function useRememberedListParams({
  screenId,
  enabled,
  store,
  known,
}: RememberedListParamsArgs): void {
  const nav = useNav();
  const current = useMemo(
    () => stripScreenPrefix(nav.searchParams, screenId),
    [nav.searchParams, screenId],
  );
  const phaseRef = useRef<{ screenId: string; phase: Phase }>({ screenId, phase: "pending" });

  useEffect(() => {
    // skip: remembering is not enabled
    if (!enabled) return;
    if (phaseRef.current.screenId !== screenId) phaseRef.current = { screenId, phase: "pending" };
    const state = phaseRef.current;
    const currentIsEmpty = Object.keys(current).length === 0;

    if (state.phase === "pending" && currentIsEmpty) {
      const stored = sanitizeStoredListState(store.read(screenId), known)?.params;
      if (stored !== undefined && Object.keys(stored).length > 0) {
        state.phase = "restoring";
        nav.setSearchParams(
          Object.fromEntries(Object.entries(stored).map(([k, v]) => [`${screenId}.${k}`, v])),
        );
        // skip: restore started, effect reruns with the restored URL
        return;
      }
    }
    // skip: waiting for the restored URL to arrive
    if (state.phase === "restoring" && currentIsEmpty) return;
    state.phase = "live";

    const existing = store.read(screenId);
    // skip: nothing stored and nothing to store
    if (existing?.params === undefined && currentIsEmpty) return;
    // skip: stored state already matches the URL
    if (existing?.params !== undefined && sameParams(existing.params, current)) return;
    store.write(screenId, { ...existing, params: current });
  }, [enabled, screenId, current, known, store, nav]);
}

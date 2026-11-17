import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryHub } from "../context/dispatcher-context.tsx";
import { usePageVisibility } from "../context/page-visibility-context.tsx";
import {
  isValidConcurrency,
  type QueryEntryState,
  queryHubKey,
  selectQueryData,
} from "../context/query-hub.ts";
import type { DispatcherError } from "../headless/index.ts";
import { useLiveEvents } from "../sse/live-events.tsx";
import { useLiveEntitiesForQuery } from "./live-query-entities.ts";

export { entityFromQueryType } from "./live-query-entities.ts";

// React wrapper around the query hub of the DispatcherProvider. Hooks with the
// same type and serialized payload share one state per key: one request on
// mount, one per polling tick and live refetch, and a refetch from any hook
// updates all of them. The state is held only while a hook is subscribed, so
// there is no cache; `refetch` reloads after a mutation.
//
// Cancellation lives in the hub: a newer fetch aborts the older one's network
// call, and the last unsubscribe aborts whatever is still running.
//
// Result shape modeled on the dispatcher's own QueryResult: callers branch on
// `loading | data | error` without undefined-juggling. The first render is
// `loading: true, data: null, error: null`. After an error, the last data stays.

export type UseQueryResult<TData> = {
  readonly data: TData | null;
  readonly error: DispatcherError | null;
  readonly loading: boolean;
  readonly refetch: () => Promise<void>;
};

export type UseQueryOptions = {
  // When false, skips the automatic fetch-on-mount and re-fetch on
  // dep-change. Useful for lazy queries that only run after a user
  // action. `refetch()` still works as an imperative trigger.
  readonly enabled?: boolean;
  // When true, subscribe to SSE events and refetch on any
  // create/update/delete/restore event of the query's entities: the one parsed
  // from the `<feature>:query:<entity>:<verb>` type plus the handler's
  // `liveEntities` (projected into FeatureSchema.queryLiveEntities, read via
  // useAppFeatures — without an AppFeaturesProvider only the parsed one).
  readonly live?: boolean;
  // Re-runs the query every N ms while enabled. Ticks are silent (no
  // `loading` flip) and skipped while a fetch is still in flight. Only
  // timers are used, so it behaves the same on web and React Native.
  readonly refetchIntervalMs?: number;
  // Caps simultaneous dispatcher.query calls for this query name across
  // all hooks under the same DispatcherProvider; extra requests wait in
  // line (loading stays true). A hook that unmounts or refetches while
  // waiting leaves the line without taking a slot. Unset = no cap.
  readonly concurrency?: number;
  // Reads only this top-level field of the answer; hooks with the same type
  // and payload share one request whatever their resultField.
  readonly resultField?: string;
};

export function useQuery<TData = unknown>(
  type: string,
  payload: unknown,
  options: UseQueryOptions = {},
): UseQueryResult<TData> {
  const hub = useQueryHub();
  const { enabled = true, live = false, refetchIntervalMs, concurrency, resultField } = options;
  const validConcurrency = isValidConcurrency(concurrency) ? concurrency : undefined;

  // Serialize payload so object-identity-changes across renders (the
  // caller building a fresh `{}` every render) don't loop.
  const payloadKey = JSON.stringify(payload);
  const key = queryHubKey(type, payloadKey);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  // Must run before the polling and live effects: its subscribe effect creates the hub entry they use.
  const subscribe = useCallback(
    (listener: () => void) =>
      hub.subscribe(
        key,
        { type, payload: payloadRef.current, concurrency: validConcurrency, autoLoad: enabled },
        listener,
      ),
    [hub, key, type, enabled, validConcurrency],
  );
  const getSnapshot = useCallback(() => hub.getState(key), [hub, key]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A payload change keeps showing the previous key's answer until the new one settles.
  const lastSettled = useRef<QueryEntryState | undefined>(undefined);
  if (state?.settled === true) lastSettled.current = state;
  const shown = state?.settled === true ? state : lastSettled.current;

  const refetch = useCallback((): Promise<void> => hub.load(key, "refetch"), [hub, key]);

  const pageVisibility = usePageVisibility();
  useEffect(() => {
    // skip: polling off or disabled query
    if (!enabled || refetchIntervalMs === undefined) return;
    // skip: non-positive or non-finite interval disables polling
    if (!Number.isFinite(refetchIntervalMs) || refetchIntervalMs <= 0) return;
    const tick = (): void => {
      // skip: nobody sees the page, the return to the page retries
      if (pageVisibility.getSnapshot() === "hidden") return;
      void hub.load(key, "poll");
    };
    const timer = setInterval(tick, refetchIntervalMs);
    const unsubscribe = pageVisibility.subscribe(tick);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, refetchIntervalMs, hub, key, pageVisibility]);

  // Live mode: the hub opens one SSE subscription per key and refetches on events.
  const subscribeLive = useLiveEvents();
  const liveEntities = useLiveEntitiesForQuery(type);
  useEffect(() => {
    // skip: live mode or query disabled, no SSE subscription needed
    if (!live || !enabled) return;
    // skip: no entity to listen on, nothing to subscribe to
    if (liveEntities.length === 0) return;
    return hub.watchLive(key, subscribeLive, liveEntities);
  }, [live, enabled, liveEntities, hub, key, subscribeLive]);

  return {
    data: shown ? selectQueryData<TData>(shown, resultField) : null,
    error: shown?.error ?? null,
    loading: state === undefined ? enabled : state.loading,
    refetch,
  };
}

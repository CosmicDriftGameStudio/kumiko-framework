import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatcher, useOptionalQueryPools } from "../context/dispatcher-context.tsx";
import type { QuerySlot } from "../context/query-pool.ts";
import type { DispatcherError } from "../headless/index.ts";
import { useLiveEvents } from "../sse/live-events.tsx";
import { subscribeToEntities, useLiveEntitiesForQuery } from "./live-query-entities.ts";
import { createLiveRefetchScheduler } from "./live-refetch-scheduler.ts";

export { entityFromQueryType } from "./live-query-entities.ts";

// React wrapper around dispatcher.query. Fires on mount, re-fires
// whenever `type` or the serialized payload change, and exposes a
// `refetch` imperative hook for after-mutation reloads.
//
// Cancellation: each fetch owns an AbortController; a newer fetch
// (change in deps or manual refetch) aborts the older one's network
// call before firing, so a slow request can't overwrite a fresh one.
// Unmount aborts any in-flight call too — React will throw the
// "state on unmounted" warning if we set state after unmount, and
// aborting pre-emptively makes that path a no-op.
//
// Result shape modeled on the dispatcher's own QueryResult: a
// discriminated state so callers can branch on `loading | data | error`
// without undefined-juggling. The first render is `loading: true,
// data: null, error: null` (no optimistic "online" cache — add that
// later if needed).

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
};

function isValidConcurrency(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 1;
}

export function useQuery<TData = unknown>(
  type: string,
  payload: unknown,
  options: UseQueryOptions = {},
): UseQueryResult<TData> {
  const dispatcher = useDispatcher();
  const { enabled = true, live = false, refetchIntervalMs, concurrency } = options;
  const queryPools = useOptionalQueryPools();

  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<DispatcherError | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);

  // Track the AbortController for the most recent fetch so a newer
  // call can cancel the older one. Ref, not state, because the
  // controller identity shouldn't trigger a re-render.
  const activeCtrl = useRef<AbortController | null>(null);
  // A tick that aborted a running fetch would starve slow queries, so
  // ticks consult this flag instead.
  const fetchInFlight = useRef(false);

  // Serialize payload so object-identity-changes across renders (the
  // caller building a fresh `{}` every render) don't loop. Strings are
  // stable by reference in React's dep-array check.
  const payloadKey = JSON.stringify(payload);

  // `dispatcher` is stable (context identity); `type` + `payloadKey`
  // are the meaningful re-run triggers. `payload` itself is intentionally
  // not in deps — it's serialized into payloadKey above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: payload goes through payloadKey
  const runFetch = useCallback(
    async (background: boolean): Promise<void> => {
      // Abort whatever's in flight. observer on Safari 17+ handles this
      // without raising a fetch-throw in the previous caller — they
      // already set the error path.
      activeCtrl.current?.abort();
      const ctrl = new AbortController();
      activeCtrl.current = ctrl;

      fetchInFlight.current = true;
      if (!background) setLoading(true);
      let result: Awaited<ReturnType<typeof dispatcher.query<TData>>>;
      let slot: QuerySlot | null = null;
      try {
        if (queryPools !== undefined && isValidConcurrency(concurrency)) {
          slot = await queryPools.acquire(type, Math.floor(concurrency), ctrl.signal);
          // skip: aborted while queued, the superseding run owns the state
          if (slot === null) return;
          // skip: slot granted just as the run was superseded, finally frees it
          if (ctrl.signal.aborted) return;
        }
        result = await dispatcher.query<TData>(type, payload, { signal: ctrl.signal });
      } finally {
        slot?.release();
        // A rejected fetch must not leave polling stuck; a superseded one must
        // not clear the newer fetch's flag.
        if (activeCtrl.current === ctrl) fetchInFlight.current = false;
      }
      // skip: a newer fetch already superseded this one, don't clobber its state
      if (ctrl.signal.aborted) return;
      if (result.isSuccess) {
        setData(result.data);
        setError(null);
      } else {
        // A cancelled request comes back with code "aborted" from the
        // skip: aborted request, a newer run already replaces this result
        if (result.error.code === "aborted") return;
        setError(result.error);
      }
      setLoading(false);
    },
    [dispatcher, type, payloadKey, queryPools, concurrency],
  );

  const run = useCallback((): Promise<void> => runFetch(false), [runFetch]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      // skip: query disabled, loading state already cleared above
      return;
    }
    void run();
    return () => {
      activeCtrl.current?.abort();
      fetchInFlight.current = false;
    };
  }, [enabled, run]);

  useEffect(() => {
    // skip: polling off or disabled query
    if (!enabled || refetchIntervalMs === undefined) return;
    // skip: non-positive or non-finite interval disables polling
    if (!Number.isFinite(refetchIntervalMs) || refetchIntervalMs <= 0) return;
    const timer = setInterval(() => {
      // skip: a fetch is still running, the next tick retries
      if (fetchInFlight.current) return;
      void runFetch(true);
    }, refetchIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, refetchIntervalMs, runFetch]);

  // Live mode: listen for SSE events for the query entity and refetch.
  // A separate effect ensures changes to `live` or `type` update the
  // subscription lifecycle exactly once.
  const subscribeLive = useLiveEvents();
  const liveEntities = useLiveEntitiesForQuery(type);
  useEffect(() => {
    // skip: live mode or query disabled, no SSE subscription needed
    if (!live || !enabled) return;
    // skip: no entity to listen on, nothing to subscribe to
    if (liveEntities.length === 0) return;
    const scheduler = createLiveRefetchScheduler(() => runFetch(true));
    const unsubscribe = subscribeToEntities(subscribeLive, liveEntities, scheduler.trigger);
    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [live, enabled, liveEntities, runFetch, subscribeLive]);

  return { data, error, loading, refetch: run };
}

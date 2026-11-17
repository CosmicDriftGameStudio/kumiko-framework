import { useEffect, useRef } from "react";
import { useLiveEvents } from "../sse/live-events.tsx";
import { subscribeToEntities, useLiveEntitiesForQuery } from "./live-query-entities.ts";
import { createLiveRefetchScheduler } from "./live-refetch-scheduler.ts";

export type UseLiveRefetchOptions = { readonly enabled?: boolean };

// For hooks that fetch a query themselves (all-pages loaders, custom aggregations):
// reruns `refetch` when an entity the query's handler projects changes, coalesced like useQuery({ live: true }).
export function useLiveRefetch(
  type: string,
  refetch: () => Promise<void> | void,
  options: UseLiveRefetchOptions = {},
): void {
  const { enabled = true } = options;
  const subscribeLive = useLiveEvents();
  const liveEntities = useLiveEntitiesForQuery(type);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    // skip: disabled or the query projects no live entity
    if (!enabled || liveEntities.length === 0) return;
    const scheduler = createLiveRefetchScheduler(() => refetchRef.current());
    const unsubscribe = subscribeToEntities(subscribeLive, liveEntities, scheduler.trigger);
    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [enabled, liveEntities, subscribeLive]);
}

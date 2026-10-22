// Platform-neutral live-events contract. The platform (Web with
// EventSource, Native with polyfill) supplies a `LiveEventSubscriber`
// via `<LiveEventsProvider value={...}>`; the shared layer consumes
// only the interface.
//
// A Context is used instead of a module singleton as before the split:
// a module singleton couples the code to a global connection. Context
// lets the caller provide a different subscription source per tree,
// which is useful for tests (Fake-Feed), multi-tenant bridges, and
// the Native renderer, where connection lifecycle often differs from
// the app lifecycle.

import { createContext, type ReactNode, useContext } from "react";

// Signal only: the server sends no field values over /api/sse — consumers
// refetch via query, which runs its own access check.
export type LiveEvent = {
  readonly type: string;
  readonly data: {
    /** Absent on anonymous connections: the signal would reveal hidden rows. */
    readonly id?: string;
    readonly aggregateType: string;
    readonly eventType: string;
    /** Absent on anonymous connections, like `id`. */
    readonly version?: number;
    readonly createdAt: string;
  };
};

/** Synthetic eventType delivered to every subscribed entity after the stream
 *  reconnected: frames during the gap are lost, so consumers must refetch. */
export const LIVE_RESYNC_EVENT_TYPE = "live.resync";

/** Subscribes to live events for an entity (aggregateType) and returns the
 *  unsubscribe function. Multiple subscriptions to the same entity are
 *  allowed in parallel; each receives its own event. */
export type LiveEventSubscriber = (
  entityName: string,
  listener: (event: LiveEvent) => void,
) => () => void;

// If no provider is present, return a no-op subscriber instead of
// throwing. This allows useQuery({ live: true }) to be optimistically
// disabled without tearing down the entire tree when the platform has
// temporarily disabled SSE. Error signals are silently swallowed; this
// is intentional and documented.
const noopSubscriber: LiveEventSubscriber = () => () => {};

const LiveEventsContext = createContext<LiveEventSubscriber>(noopSubscriber);

export type LiveEventsProviderProps = {
  readonly children: ReactNode;
  readonly value: LiveEventSubscriber;
};

export function LiveEventsProvider({ children, value }: LiveEventsProviderProps): ReactNode {
  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

/** Hook for a useQuery-like consumer. Returns the subscription function
 *  from the context. Without a provider, it is a no-op. */
export function useLiveEvents(): LiveEventSubscriber {
  return useContext(LiveEventsContext);
}

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import type { Dispatcher, DispatcherStatus } from "../headless/index.ts";
import { useStore } from "../hooks/use-store.ts";
import { createQueryHub, type QueryHub } from "./query-hub.ts";
import { createQueryPools } from "./query-pool.ts";

// React Context threading the Dispatcher through the tree. An app
// wraps its root in <DispatcherProvider dispatcher={createLiveDispatcher()}>
// and every hook below reaches into that context instead of taking the
// dispatcher as a prop on every call site. Same pattern most routers
// and query-libraries use; nothing novel, but worth spelling out once.
//
// The context holds the Dispatcher INSTANCE, not a factory — a single
// dispatcher per app (rebuilding would wipe its in-flight tracking and
// status listeners). Tests wire a fake dispatcher in directly.

const DispatcherContext = createContext<Dispatcher | null>(null);
const QueryHubContext = createContext<QueryHub | null>(null);

export type DispatcherProviderProps = {
  readonly dispatcher: Dispatcher;
  readonly children: ReactNode;
};

export function DispatcherProvider({ dispatcher, children }: DispatcherProviderProps): ReactNode {
  // Pools live with the provider so every hook of one query name shares them.
  const [queryPools] = useState(createQueryPools);
  const queryHub = useMemo(() => createQueryHub(dispatcher, queryPools), [dispatcher, queryPools]);
  return (
    <DispatcherContext value={dispatcher}>
      <QueryHubContext value={queryHub}>{children}</QueryHubContext>
    </DispatcherContext>
  );
}

// Reads the ambient Dispatcher. Throws instead of returning null when
// no provider is mounted — a dispatcher-less hook is always a
// developer error (the app forgot to wrap its root) and surfacing it
// early beats debugging "why did my write silently do nothing" later.
export function useDispatcher(): Dispatcher {
  const dispatcher = useContext(DispatcherContext);
  if (!dispatcher) {
    throw new Error(
      "useDispatcher: no <DispatcherProvider> mounted above this component. Wrap your app root with <DispatcherProvider dispatcher={createLiveDispatcher()}>.",
    );
  }
  return dispatcher;
}

// Soft variant: returns null when no provider is mounted instead of throwing. For
// components that optionally need a Dispatcher (for example, KumikoScreen renders
// with or without rowActions; the test suite does not mount a Dispatcher when the
// screen triggers no mutation). Callers must provide a sensible fallback for null
// (typically, no action wiring).
export function useOptionalDispatcher(): Dispatcher | undefined {
  return useContext(DispatcherContext) ?? undefined;
}

// Subscribes to online/offline/syncing transitions. The dispatcher
// exposes `statusStore: Store<DispatcherStatus>` directly; useStore is
// the canonical React-binding for that contract.
//
// Server rendering: useStore reads the store's getServerSnapshot which
// returns the same snapshot the client sees on hydration — for the
// live-dispatcher that's "online" (the optimistic boot default), so
// no flash on hydration.
export function useDispatcherStatus(): DispatcherStatus {
  return useStore(useDispatcher().statusStore);
}

export function useQueryHub(): QueryHub {
  const hub = useContext(QueryHubContext);
  if (!hub) {
    throw new Error(
      "useQueryHub: no <DispatcherProvider> mounted above this component. Wrap your app root with <DispatcherProvider dispatcher={createLiveDispatcher()}>.",
    );
  }
  return hub;
}

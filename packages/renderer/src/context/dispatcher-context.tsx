import type { Dispatcher, DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "../hooks/use-store.js";
import { createQueryPools, type QueryPools } from "./query-pool.js";

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
const QueryPoolsContext = createContext<QueryPools | null>(null);

export type DispatcherProviderProps = {
  readonly dispatcher: Dispatcher;
  readonly children: ReactNode;
};

export function DispatcherProvider({ dispatcher, children }: DispatcherProviderProps): ReactNode {
  // Pools live with the provider so every hook of one query name shares them.
  const [queryPools] = useState(createQueryPools);
  return (
    <DispatcherContext value={dispatcher}>
      <QueryPoolsContext value={queryPools}>{children}</QueryPoolsContext>
    </DispatcherContext>
  );
}

export function useOptionalQueryPools(): QueryPools | undefined {
  return useContext(QueryPoolsContext) ?? undefined;
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

// Soft-Variante: null wenn kein Provider mounted statt throw. Für
// Components die einen Dispatcher OPTIONAL brauchen (z.B. KumikoScreen
// rendert mit/ohne rowActions; die Test-Suite mountet kein Dispatcher
// wenn der Screen keine Mutation triggert). Caller ist zuständig dass
// er bei null einen sinnvollen Fallback hat (typisch: kein Action-Wiring).
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

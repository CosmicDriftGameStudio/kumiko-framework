import type { Dispatcher, DispatcherStatus } from "@kumiko/headless";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

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

export type DispatcherProviderProps = {
  readonly dispatcher: Dispatcher;
  readonly children: ReactNode;
};

export function DispatcherProvider({ dispatcher, children }: DispatcherProviderProps): ReactNode {
  return <DispatcherContext value={dispatcher}>{children}</DispatcherContext>;
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

// Subscribes to online/offline/syncing transitions via
// useSyncExternalStore — React 18+'s concurrent-safe subscription
// primitive. The dispatcher exposes `status()` (getSnapshot) and
// `subscribeStatus()` (Pull-Style subscribe) which match the hook's
// contract directly.
//
// Server rendering: returns "online" during SSR (no network state
// available yet). The app renders, hydrates, the first client tick
// picks up the real status. Doesn't flash because "online" is also
// the default optimistic status on the client.
export function useDispatcherStatus(): DispatcherStatus {
  const dispatcher = useDispatcher();
  return useSyncExternalStore(dispatcher.subscribeStatus, dispatcher.status, () => "online");
}

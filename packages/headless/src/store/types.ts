// Store contract — Pull-Style Subscribe/Emit matching React's
// useSyncExternalStore signature. The single canonical shape for
// every stateful controller in ui-core/renderer land (form,
// dispatcher-status, locale, token, nav, lifecycle).
//
// Rationale in docs/plans/ui-store.md. Not a new state-management
// decision — ui-decisions.md already picked Subscribe/Emit; this
// module just materializes the pattern instead of rolling a new
// Set<() => void> per controller.

export type Store<T> = {
  // Current snapshot. Referentially stable across no-op setState calls
  // (see createStore's Object.is gate) so useSyncExternalStore doesn't
  // re-render consumers when nothing actually changed.
  getSnapshot(): T;
  // Subscribe listener, returns unsubscribe. Listener receives no
  // payload — it reads via getSnapshot(). Direct match for
  // useSyncExternalStore's contract.
  subscribe(listener: () => void): () => void;
};

export type WritableStore<T> = Store<T> & {
  // Update with a new value or a reducer function. If the resulting
  // snapshot is Object.is-equal to the current one, listeners are NOT
  // notified — re-render prevention at the source.
  setState(next: T | ((prev: T) => T)): void;
};

// Late-bound reference for values that only exist AFTER setupTestStack
// returns — typically the session-callbacks, which close over stack.db.
//
// Without this helper, integration tests repeat the same trampoline
// pattern (let real; async wrapper; null-check on each call). The holder
// inverts the dependency: the test passes the trampolines into setupTestStack
// first, then injects the concrete impl once db is available.
//
// Production wiring (runDevApp / runProdApp) doesn't reuse this — those
// wrappers inline an equivalent let-closure-throw pattern to avoid the
// runtime-isolation cross from dev → test packages. Same idea, different
// file.

export type LateBoundHolder<T> = {
  /** Store the concrete value. Must be called before any trampoline fires. */
  set(value: T): void;
  /** Fetch the concrete value or throw if set() hasn't been called yet. */
  get(): T;
  /** True after set() has been called. */
  isReady(): boolean;
};

export function createLateBoundHolder<T>(label = "value"): LateBoundHolder<T> {
  let value: T | undefined;
  return {
    set(v) {
      value = v;
    },
    get() {
      if (value === undefined) {
        throw new Error(`late-bound ${label} accessed before set() was called`);
      }
      return value;
    },
    isReady() {
      return value !== undefined;
    },
  };
}

// Process lifecycle manager: 4-state machine + LIFO shutdown hooks + drain
// with force-timeout. Designed to be injected into buildServer; tests can
// drain() directly without signal plumbing.
//
// Scope v1 — what this file owns:
//   - State machine (starting → ready → draining → stopped), strictly forward
//   - Shutdown-hook registry, drained in LIFO order
//   - drain() with a gesamt-timeout that force-transitions to `stopped`
//   - onStateChange subscribers with unsubscribe
//
// Out of scope v1 (see architecture/lifecycle.md for the full picture):
//   - Startup-phase system with per-phase timeouts/retries
//   - Heartbeat + leader-election
//   - Readiness-check registry beyond raw state
//   - Signal-handler wiring (separate `attachSignalHandlers` helper)

export type LifecycleState = "starting" | "ready" | "draining" | "stopped";

export type StateChangeListener = (from: LifecycleState, to: LifecycleState) => void;

export type ShutdownHookFn = (signal: string) => Promise<void>;

export interface Lifecycle {
  state(): LifecycleState;
  uptimeSec(): number;
  markReady(): void;
  onStateChange(cb: StateChangeListener): () => void;
  registerShutdownHook(name: string, fn: ShutdownHookFn): void;
  drain(opts?: { signal?: string; timeoutMs?: number }): Promise<void>;
}

export type LifecycleOptions = {
  // Start directly in "ready" state. Useful for tests that don't want to
  // orchestrate a full startup sequence.
  readonly startReady?: boolean;
  // Injectable clock for deterministic uptimeSec assertions.
  readonly now?: () => number;
};

const DEFAULT_DRAIN_TIMEOUT_MS = 40_000;

export function createLifecycle(opts: LifecycleOptions = {}): Lifecycle {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();

  let current: LifecycleState = opts.startReady ? "ready" : "starting";
  const listeners = new Set<StateChangeListener>();
  const hooks: Array<{ name: string; fn: ShutdownHookFn }> = [];
  let drainPromise: Promise<void> | null = null;

  function transition(to: LifecycleState): void {
    const from = current;
    // skip: no real state change (e.g. markReady() on an already-ready
    // lifecycle). Listeners only fire on actual transitions.
    if (from === to) return;
    current = to;
    for (const cb of listeners) {
      try {
        cb(from, to);
      } catch {
        // A broken listener must not tear the state machine down. We swallow
        // here; the listener is responsible for its own error reporting.
      }
    }
  }

  async function drainOnce(signal: string, timeoutMs: number): Promise<void> {
    transition("draining");

    const runAllHooks = async (): Promise<void> => {
      // LIFO: the last thing registered is the first thing stopped. Matches
      // the "things registered later depend on things registered earlier"
      // convention — tear them down in reverse dependency order.
      for (let i = hooks.length - 1; i >= 0; i--) {
        const hook = hooks[i];
        if (!hook) continue;
        try {
          await hook.fn(signal);
        } catch {
          // Hook failure is isolated: one broken hook must not block the
          // others. Consumers that need error surfacing should observe via
          // their own logger inside the hook.
        }
      }
    };

    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const forcePromise = new Promise<void>((resolve) => {
      forceTimer = setTimeout(resolve, timeoutMs);
    });

    try {
      await Promise.race([runAllHooks(), forcePromise]);
    } finally {
      if (forceTimer) clearTimeout(forceTimer);
      transition("stopped");
    }
  }

  return {
    state: () => current,

    uptimeSec: () => Math.floor((now() - startedAt) / 1000),

    markReady: () => {
      // skip: already past the "starting" phase. markReady is idempotent
      // so boot orchestrators can call it defensively without branching.
      if (current !== "starting") return;
      transition("ready");
    },

    onStateChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    registerShutdownHook: (name, fn) => {
      // Accepting hooks after `draining` has started would silently drop them
      // — better to reject so mis-wired late registrations surface.
      if (current === "draining" || current === "stopped") {
        throw new Error(
          `Cannot register shutdown hook "${name}" — lifecycle is already ${current}`,
        );
      }
      hooks.push({ name, fn });
    },

    drain: async (drainOpts = {}) => {
      const signal = drainOpts.signal ?? "manual";
      const timeoutMs = drainOpts.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;

      // Re-entrant drain: concurrent calls share the in-flight promise.
      // Post-stop calls are a no-op so double-SIGTERM doesn't double-run hooks.
      if (drainPromise) return drainPromise;
      // skip: already fully stopped (e.g. SIGTERM arrives after drain finished).
      // Returning without action keeps the post-drain state pristine.
      if (current === "stopped") return;

      drainPromise = drainOnce(signal, timeoutMs);
      return drainPromise;
    },
  };
}

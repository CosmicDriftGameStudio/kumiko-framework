// Process lifecycle: 4-state machine + LIFO shutdown hooks.
// Signal wiring lives in signal-handlers.ts; v1 scope in architecture/lifecycle.md.

import type { Logger } from "../logging/types";

export type LifecycleState = "starting" | "ready" | "draining" | "stopped";

export type StateChangeListener = (from: LifecycleState, to: LifecycleState) => void;

export type ShutdownHookFn = (signal: string) => Promise<void>;

export interface Lifecycle {
  state(): LifecycleState;
  uptimeSec(): number;
  markReady(): void;
  onStateChange(cb: StateChangeListener): () => void;
  registerShutdownHook(name: string, fn: ShutdownHookFn): void;
  // Introspection: which hooks are registered, in registration order (drain
  // runs them reversed). Used by ops + integration tests to verify that
  // auto-wired hooks (e.g. eventDispatcher.stop) actually landed.
  hookNames(): readonly string[];
  drain(opts?: { signal?: string; timeoutMs?: number }): Promise<void>;
}

export type LifecycleOptions = {
  // Start directly in "ready" state. Useful for tests that don't want to
  // orchestrate a full startup sequence.
  readonly startReady?: boolean;
  /** @internal Test-only clock injection for deterministic uptimeSec assertions. */
  readonly now?: () => number;
  // Structured logger for hook / listener failures. Falls back to
  // console.error when absent — matches the pattern in pipeline/lifecycle-pipeline.ts
  // so one-file scripts and test setups don't need to wire a logger.
  readonly logger?: Pick<Logger, "error">;
};

const DEFAULT_DRAIN_TIMEOUT_MS = 40_000;

export function createLifecycle(opts: LifecycleOptions = {}): Lifecycle {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const logError = makeErrorLogger(opts.logger);

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
      } catch (err) {
        // A broken listener must not tear the state machine down, but swallowing
        // silently hides bugs from ops. Log and move on.
        logError(`onStateChange listener threw during ${from}→${to}`, err);
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
        } catch (err) {
          // Isolated failure: one broken hook must not block the others. Log
          // so ops can see which hook failed during shutdown — silent swallow
          // made prod incidents invisible.
          logError(`shutdown hook "${hook.name}" threw`, err);
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

    hookNames: () => hooks.map((h) => h.name),

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

function makeErrorLogger(
  logger: Pick<Logger, "error"> | undefined,
): (msg: string, err: unknown) => void {
  if (logger) {
    return (msg, err) => logger.error(`[lifecycle] ${msg}`, { err });
  }
  // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
  return (msg, err) => console.error(`[lifecycle] ${msg}:`, err);
}

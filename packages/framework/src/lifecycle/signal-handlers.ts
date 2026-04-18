// Opt-in signal handlers. Kept separate from createLifecycle() so test
// processes don't accidentally hijack SIGTERM/SIGINT — production `main.ts`
// calls this explicitly, tests drive drain() directly.

import type { Lifecycle } from "./lifecycle";

export type AttachSignalHandlersOptions = {
  readonly timeoutMs?: number;
  // Which signals to listen for. Default covers orchestrator (K8s, systemd)
  // SIGTERM and interactive Ctrl-C (SIGINT).
  readonly signals?: readonly NodeJS.Signals[];
  // Called after drain completes, default: process.exit(0). Inject a stub in
  // tests to assert exit was requested without terminating the test runner.
  readonly exit?: (code: number) => void;
};

export type SignalHandlerHandle = {
  // Remove the listeners added by attach(). Useful for tests and for hot-
  // swapping the lifecycle in a long-running process.
  detach(): void;
};

export function attachSignalHandlers(
  lifecycle: Lifecycle,
  opts: AttachSignalHandlersOptions = {},
): SignalHandlerHandle {
  const signals: readonly NodeJS.Signals[] = opts.signals ?? ["SIGTERM", "SIGINT"];
  const exitFn = opts.exit ?? ((code) => process.exit(code));

  const listeners = new Map<NodeJS.Signals, () => void>();
  // Guard so double-SIGTERM doesn't call exitFn twice. drain() is already
  // idempotent via its shared promise, but its .then/.catch chain would fire
  // per signal otherwise.
  let exitScheduled = false;

  for (const sig of signals) {
    const handler = () => {
      // skip: exit already scheduled by a prior signal — drain() is in flight
      // and will fire exitFn itself when it settles. Second signal is a no-op.
      if (exitScheduled) return;
      exitScheduled = true;
      void lifecycle
        .drain({
          signal: sig,
          ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
        })
        .then(() => exitFn(0))
        .catch(() => exitFn(1));
    };
    process.on(sig, handler);
    listeners.set(sig, handler);
  }

  return {
    detach: () => {
      for (const [sig, handler] of listeners) {
        process.off(sig, handler);
      }
      listeners.clear();
    },
  };
}

export type ShutdownSignal = "SIGTERM" | "SIGINT";

/** `false` keeps the process signals untouched (the app installs its own
 *  handlers). The object form tunes the drain budget. */
export type SignalsOption = false | { readonly drainTimeoutMs?: number };

// Kubernetes sends SIGKILL after terminationGracePeriodSeconds (default 30 s).
// Draining 25 s leaves room for the exit and the final log line before that.
export const DEFAULT_DRAIN_TIMEOUT_MS = 25_000;

export type SignalProcess = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export type ShutdownSignalDeps = {
  readonly stop: () => Promise<void>;
  readonly drainTimeoutMs?: number;
  readonly signalProcess?: SignalProcess;
  readonly exit?: (code: number) => void;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string, error: unknown) => void;
};

type DrainOutcome = { readonly kind: "drained" } | { readonly kind: "timeout" };

/** Registers SIGTERM/SIGINT: the first signal drains via `stop()` and exits
 *  0, a drain that fails or outlives the timeout exits 1. Returns the
 *  uninstall function so `stop()` can drop the listeners again. */
export function installShutdownSignals(deps: ShutdownSignalDeps): () => void {
  const signalProcess = deps.signalProcess ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  // biome-ignore lint/suspicious/noConsole: shutdown progress, no logger at this level
  const log = deps.log ?? ((message: string) => console.log(message));
  const logError =
    deps.logError ??
    // biome-ignore lint/suspicious/noConsole: shutdown-time error, only path is stderr
    ((message: string, error: unknown) => console.error(message, error));
  const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  let shuttingDown = false;

  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    // skip: shutdown already in progress, a second signal must not double-drain
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[runProdApp] ${signal} received — draining (timeout ${drainTimeoutMs}ms)…`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DrainOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), drainTimeoutMs);
    });
    let exitCode = 0;
    try {
      const outcome = await Promise.race([
        deps.stop().then((): DrainOutcome => ({ kind: "drained" })),
        timeout,
      ]);
      if (outcome.kind === "timeout") {
        exitCode = 1;
        logError(`[runProdApp] drain exceeded ${drainTimeoutMs}ms, exiting anyway`, undefined);
      } else {
        log("[runProdApp] graceful shutdown complete.");
      }
    } catch (error) {
      exitCode = 1;
      logError("[runProdApp] error during shutdown:", error);
    } finally {
      clearTimeout(timer);
    }
    exit(exitCode);
  };

  const onSigterm = (): void => void shutdown("SIGTERM");
  const onSigint = (): void => void shutdown("SIGINT");
  signalProcess.on("SIGTERM", onSigterm);
  signalProcess.on("SIGINT", onSigint);
  return () => {
    signalProcess.off("SIGTERM", onSigterm);
    signalProcess.off("SIGINT", onSigint);
  };
}

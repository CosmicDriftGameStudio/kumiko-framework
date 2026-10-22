import { type Logger, scrubLogText } from "@cosmicdrift/kumiko-framework/logging";

export type FatalErrorHandlersOptions = {
  readonly logger: Pick<Logger, "error">;
  readonly stop: () => Promise<void>;
  readonly exit?: (code: number) => void;
  readonly hardExitMs?: number;
};

const DEFAULT_HARD_EXIT_MS = 10_000;

function describeFatal(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: scrubLogText(reason.message),
      ...(reason.stack !== undefined && { stack: scrubLogText(reason.stack) }),
    };
  }
  return { message: scrubLogText(String(reason)) };
}

// A process in an unknown state must not keep serving; the hard-exit timer
// covers a stop() that hangs on the very fault that triggered it.
export function installFatalErrorHandlers(options: FatalErrorHandlersOptions): () => void {
  const { logger, stop } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const hardExitMs = options.hardExitMs ?? DEFAULT_HARD_EXIT_MS;
  let handling = false;
  let stopRunning = false;

  const handle = (source: "uncaughtException" | "unhandledRejection") => (reason: unknown) => {
    // skip: a second fault during shutdown is already covered by the running stop and hard-exit timer
    if (handling) return;
    handling = true;
    logger.error("fatal process error, shutting down", {
      fatal: true,
      source,
      ...describeFatal(reason),
    });
    const hardExitTimer = setTimeout(() => exit(1), hardExitMs);
    hardExitTimer.unref();
    stopRunning = true;
    void stop()
      .catch((stopError: unknown) => {
        logger.error("shutdown after fatal error failed", describeFatal(stopError));
      })
      .finally(() => {
        stopRunning = false;
        clearTimeout(hardExitTimer);
        exit(1);
      });
  };

  const onUncaughtException = handle("uncaughtException");
  const onUnhandledRejection = handle("unhandledRejection");
  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  return () => {
    // stop() uninstalls first; during a fatal shutdown the listeners must stay so a second fault cannot hit the default crash path mid-flush
    // skip: fatal shutdown in progress, see above.
    if (stopRunning) return;
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
  };
}

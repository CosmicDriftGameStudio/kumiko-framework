import type { Logger } from "./types.ts";

type FallbackLogger = {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};

type LogLevel = keyof FallbackLogger;
type OptionalSinkLevel = Exclude<LogLevel, "error">;

let processLogger: Logger | null = null;

// Fallback loggers created at module level before boot must pick this up, so it is read per call.
export function setProcessLogger(logger: Logger | null): void {
  processLogger = logger;
}

// Bun prints a trailing "undefined" when a second argument is passed explicitly as undefined.
function writeConsole(
  write: (...args: unknown[]) => void,
  line: string,
  data: Record<string, unknown> | undefined,
): void {
  if (data === undefined) write(line);
  else write(line, data);
}

export function createFallbackLogger(
  namespace: string,
  logger?:
    | (Pick<Logger, "error"> & Partial<Pick<Logger, "info" | "warn" | "debug" | "child">>)
    | undefined,
): FallbackLogger {
  if (logger?.child) {
    const child = logger.child({ component: namespace });
    return {
      info: (msg, data) => child.info(msg, data),
      error: (msg, data) => child.error(msg, data),
      warn: (msg, data) => child.warn(msg, data),
      debug: (msg, data) => child.debug(msg, data),
    };
  }
  type Sink = (msg: string, data?: Record<string, unknown>) => void;
  const levelLogger = <L extends LogLevel>(
    level: L,
    sinkFor: () => Sink | undefined,
  ): FallbackLogger[L] => {
    return (msg, data) => {
      const sink = sinkFor();
      if (sink) {
        sink(msg, data);
      } else {
        writeConsole(console[level], `[${namespace}] ${msg}`, data);
      }
    };
  };
  if (logger) {
    const prefixedSink = (level: OptionalSinkLevel): (() => Sink | undefined) => {
      return () => {
        const write = logger[level];
        return write && ((msg, data) => write.call(logger, `[${namespace}] ${msg}`, data));
      };
    };
    return {
      info: levelLogger("info", prefixedSink("info")),
      error(msg, data) {
        logger.error(`[${namespace}] ${msg}`, data);
      },
      warn: levelLogger("warn", prefixedSink("warn")),
      debug: levelLogger("debug", prefixedSink("debug")),
    };
  }
  let cachedParent: Logger | null = null;
  let cachedChild: Logger | null = null;
  const resolveProcessChild = (): Logger | null => {
    if (!processLogger) return null;
    if (cachedParent !== processLogger || !cachedChild) {
      cachedParent = processLogger;
      cachedChild = processLogger.child({ component: namespace });
    }
    return cachedChild;
  };
  const processChildSink = (level: LogLevel): (() => Sink | undefined) => {
    return () => {
      const child = resolveProcessChild();
      return child ? (msg, data) => child[level](msg, data) : undefined;
    };
  };
  return {
    info: levelLogger("info", processChildSink("info")),
    error: levelLogger("error", processChildSink("error")),
    warn: levelLogger("warn", processChildSink("warn")),
    debug: levelLogger("debug", processChildSink("debug")),
  };
}

// A full Logger for contexts whose typed surface promises one (ctx.obs.log) but that have no
// app logger wired; child() returns the same instance because there is no sink to scope.
export function createFallbackFullLogger(namespace: string): Logger {
  const logger: Logger = { ...createFallbackLogger(namespace), child: () => logger };
  return logger;
}

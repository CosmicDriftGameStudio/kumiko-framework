import type { Logger } from "./types.ts";

type FallbackLogger = {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};

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
  if (logger) {
    return {
      info(msg, data) {
        if (logger.info) {
          logger.info(`[${namespace}] ${msg}`, data);
        } else {
          writeConsole(console.info, `[${namespace}] ${msg}`, data);
        }
      },
      error(msg, data) {
        logger.error(`[${namespace}] ${msg}`, data);
      },
      warn(msg, data) {
        if (logger.warn) {
          logger.warn(`[${namespace}] ${msg}`, data);
        } else {
          writeConsole(console.warn, `[${namespace}] ${msg}`, data);
        }
      },
      debug(msg, data) {
        if (logger.debug) {
          logger.debug(`[${namespace}] ${msg}`, data);
        } else {
          writeConsole(console.debug, `[${namespace}] ${msg}`, data);
        }
      },
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
  return {
    info(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.info(msg, data);
      } else {
        writeConsole(console.info, `[${namespace}] ${msg}`, data);
      }
    },
    error(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.error(msg, data);
      } else {
        writeConsole(console.error, `[${namespace}] ${msg}`, data);
      }
    },
    warn(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.warn(msg, data);
      } else {
        writeConsole(console.warn, `[${namespace}] ${msg}`, data);
      }
    },
    debug(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.debug(msg, data);
      } else {
        writeConsole(console.debug, `[${namespace}] ${msg}`, data);
      }
    },
  };
}

// A full Logger for contexts whose typed surface promises one (ctx.obs.log) but that have no
// app logger wired; child() returns the same instance because there is no sink to scope.
export function createFallbackFullLogger(namespace: string): Logger {
  const logger: Logger = { ...createFallbackLogger(namespace), child: () => logger };
  return logger;
}

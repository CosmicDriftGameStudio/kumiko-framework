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

export function createFallbackLogger(
  namespace: string,
  logger?: (Pick<Logger, "error"> & Partial<Pick<Logger, "info" | "warn" | "debug">>) | undefined,
): FallbackLogger {
  if (logger) {
    return {
      info(msg, data) {
        if (logger.info) {
          logger.info(`[${namespace}] ${msg}`, data);
        } else {
          console.info(`[${namespace}] ${msg}`, data);
        }
      },
      error(msg, data) {
        logger.error(`[${namespace}] ${msg}`, data);
      },
      warn(msg, data) {
        if (logger.warn) {
          logger.warn(`[${namespace}] ${msg}`, data);
        } else {
          console.warn(`[${namespace}] ${msg}`, data);
        }
      },
      debug(msg, data) {
        if (logger.debug) {
          logger.debug(`[${namespace}] ${msg}`, data);
        } else {
          console.debug(`[${namespace}] ${msg}`, data);
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
        console.info(`[${namespace}] ${msg}`, data);
      }
    },
    error(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.error(msg, data);
      } else {
        console.error(`[${namespace}] ${msg}`, data);
      }
    },
    warn(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.warn(msg, data);
      } else {
        console.warn(`[${namespace}] ${msg}`, data);
      }
    },
    debug(msg, data) {
      const child = resolveProcessChild();
      if (child) {
        child.debug(msg, data);
      } else {
        console.debug(`[${namespace}] ${msg}`, data);
      }
    },
  };
}

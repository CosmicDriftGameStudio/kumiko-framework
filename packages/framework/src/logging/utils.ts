import type { Logger } from "./types";

type FallbackLogger = {
  error(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};

export function createFallbackLogger(
  namespace: string,
  logger?: (Pick<Logger, "error"> & Partial<Pick<Logger, "warn" | "debug">>) | undefined,
): FallbackLogger {
  if (logger) {
    return {
      error(msg, data) {
        logger.error(`[${namespace}] ${msg}`, data);
      },
      warn(msg, data) {
        if (logger.warn) {
          logger.warn(`[${namespace}] ${msg}`, data);
        } else {
          // biome-ignore lint/suspicious/noConsole: ops-visible fallback when the wrapped logger has no warn method
          console.warn(`[${namespace}] ${msg}`, data);
        }
      },
      debug(msg, data) {
        if (logger.debug) {
          logger.debug(`[${namespace}] ${msg}`, data);
        } else {
          // biome-ignore lint/suspicious/noConsole: ops-visible fallback when the wrapped logger has no debug method
          console.debug(`[${namespace}] ${msg}`, data);
        }
      },
    };
  }
  return {
    error(msg, data) {
      // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
      console.error(`[${namespace}] ${msg}`, data);
    },
    warn(msg, data) {
      // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
      console.warn(`[${namespace}] ${msg}`, data);
    },
    debug(msg, data) {
      // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
      console.debug(`[${namespace}] ${msg}`, data);
    },
  };
}

import type { Logger } from "./types";

type FallbackLogger = {
  error(msg: string, data?: Record<string, unknown>): void;
};

export function createFallbackLogger(
  namespace: string,
  logger?: Pick<Logger, "error"> | undefined,
): FallbackLogger {
  if (logger) {
    return {
      error(msg, data) {
        logger.error(`[${namespace}] ${msg}`, data);
      },
    };
  }
  return {
    error(msg, data) {
      // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
      console.error(`[${namespace}] ${msg}`, data);
    },
  };
}

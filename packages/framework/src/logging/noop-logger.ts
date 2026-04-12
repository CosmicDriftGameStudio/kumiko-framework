import type { Logger } from "./types";

const noop = () => {};

export function createNoopLogger(): Logger {
  const logger: Logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child() {
      return logger;
    },
  };
  return logger;
}

import { createLogger, type Logger, setProcessLogger } from "@cosmicdrift/kumiko-framework/logging";
import { loggerFromExtraContext } from "./run-prod-app-boot-context.ts";

const CONSOLE_METHOD_BY_LEVEL = {
  info: "log",
  warn: "warn",
  error: "error",
  debug: "debug",
} as const;

function createConsoleLogger(prefix: string): Logger {
  const write =
    (level: keyof typeof CONSOLE_METHOD_BY_LEVEL) =>
    (msg: string, data?: Record<string, unknown>): void => {
      const method = CONSOLE_METHOD_BY_LEVEL[level];
      const line = `[${prefix}] ${msg}`;
      // biome-ignore lint/suspicious/noConsole: outside production, boot output stays human-readable on the console
      console[method](...(data ? [line, data] : [line]));
    };
  return {
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    debug: write("debug"),
    child: () => createConsoleLogger(prefix),
  };
}

// Function-form extraContext needs boot deps, so only a static one can supply the logger this early.
// Outside production no process logger is installed, so fallback loggers keep their console output.
export function installProcessLogger(extraContext: unknown, consolePrefix: string): Logger {
  const appLogger =
    typeof extraContext === "object" && extraContext !== null
      ? loggerFromExtraContext(Object.fromEntries(Object.entries(extraContext)))
      : undefined;
  if (appLogger) {
    setProcessLogger(appLogger);
    return appLogger;
  }
  if (process.env["NODE_ENV"] !== "production") return createConsoleLogger(consolePrefix);
  const logger = createLogger({ pretty: false });
  setProcessLogger(logger);
  return logger;
}

export function uninstallProcessLogger(): void {
  setProcessLogger(null);
}

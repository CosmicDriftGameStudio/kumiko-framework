import pino from "pino";
import type { Logger } from "./types";

export type LoggerOptions = {
  level?: "debug" | "info" | "warn" | "error";
  pretty?: boolean;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env["LOG_LEVEL"] as LoggerOptions["level"]) ?? "info";
  const pretty =
    options.pretty ??
    (process.env["LOG_FORMAT"] === "pretty" || process.env["NODE_ENV"] !== "production");

  const pinoLogger = pino({
    level,
    ...(pretty && {
      transport: { target: "pino-pretty", options: { colorize: true } },
    }),
  });

  return wrapPino(pinoLogger);
}

function wrapPino(p: pino.Logger): Logger {
  return {
    info(msg, data) {
      data ? p.info(data, msg) : p.info(msg);
    },
    warn(msg, data) {
      data ? p.warn(data, msg) : p.warn(msg);
    },
    error(msg, data) {
      data ? p.error(data, msg) : p.error(msg);
    },
    debug(msg, data) {
      data ? p.debug(data, msg) : p.debug(msg);
    },
    child(context) {
      return wrapPino(p.child(context));
    },
  };
}

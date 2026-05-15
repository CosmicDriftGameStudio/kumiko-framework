import pino, { type DestinationStream } from "pino";
import { observabilityContext } from "../observability";
import type { Logger } from "./types";

export type LoggerOptions = {
  level?: "debug" | "info" | "warn" | "error";
  pretty?: boolean;
  // Optional custom sink — pino writes NDJSON to it instead of stdout. Used
  // in tests that need to capture and parse log output.
  destination?: DestinationStream;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env["LOG_LEVEL"] as LoggerOptions["level"]) ?? "info"; // @cast-boundary dynamic-key
  const pretty = options.pretty ?? process.env["LOG_FORMAT"] === "pretty";

  const pinoConfig = {
    level,
    ...(pretty && !options.destination
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  };
  const pinoLogger = options.destination ? pino(pinoConfig, options.destination) : pino(pinoConfig);

  return wrapPino(pinoLogger);
}

// Pull traceId/spanId from the active observability context so every log
// line carries them when tracing is active. Empty IDs (NoopProvider) skip —
// nothing to correlate, no need to clutter output. Trace fields don't
// overwrite caller-provided data so explicit overrides still win. Exported
// for unit tests.
export function mergeTraceFields(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const span = observabilityContext.getActiveSpan();
  if (!span?.traceId) return data;
  const traceFields = { traceId: span.traceId, spanId: span.spanId };
  return data ? { ...traceFields, ...data } : traceFields;
}

function wrapPino(p: pino.Logger): Logger {
  return {
    info(msg, data) {
      const merged = mergeTraceFields(data);
      if (merged) p.info(merged, msg);
      else p.info(msg);
    },
    warn(msg, data) {
      const merged = mergeTraceFields(data);
      if (merged) p.warn(merged, msg);
      else p.warn(msg);
    },
    error(msg, data) {
      const merged = mergeTraceFields(data);
      if (merged) p.error(merged, msg);
      else p.error(msg);
    },
    debug(msg, data) {
      const merged = mergeTraceFields(data);
      if (merged) p.debug(merged, msg);
      else p.debug(msg);
    },
    child(ctx) {
      return wrapPino(p.child(ctx));
    },
  };
}

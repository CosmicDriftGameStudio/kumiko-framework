import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { requestContext } from "../api/request-context.ts";
import { createFallbackLogger } from "../logging/index.ts";
import { extractPgError } from "./pg-error.ts";

// A pool can briefly keep handing out connections the server just closed.
// Each failed attempt discards one, so retries are bounded by pool size.
const CLOSED_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ERR_POSTGRES_CONNECTION_CLOSED", // Bun.SQL
  "57P01", // PG SQLSTATE: admin_shutdown / terminated backend
]);

export function isClosedConnectionError(err: unknown): boolean {
  const code = extractPgError(err)?.code;
  return code !== undefined && CLOSED_CONNECTION_CODES.has(code);
}

// Tx/reserved handles are pinned to one physical connection — a retry there
// would run on the same dead connection, not swap in a fresh one.
export function isPooledClient(raw: unknown): boolean {
  if (raw === null || (typeof raw !== "object" && typeof raw !== "function")) return false;
  return (
    typeof propertyOf(raw, "begin") === "function" &&
    typeof propertyOf(raw, "savepoint") !== "function" &&
    typeof propertyOf(raw, "release") !== "function"
  );
}

const closedConnectionLog = createFallbackLogger("bun-sql");

function isHandleLike(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && (typeof raw === "object" || typeof raw === "function");
}

type ClosedConnectionDriver = "bun-sql" | "unknown";

// Bun.SQL pool and tx handles both carry `flush`.
function driverOf(raw: unknown): ClosedConnectionDriver {
  if (!isHandleLike(raw)) return "unknown";
  if (typeof raw["flush"] === "function") return "bun-sql";
  return "unknown";
}

function positiveNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

// Bun.SQL reports its timeout options in milliseconds.
function timeoutOptionMs(
  options: Record<string, unknown>,
  driver: ClosedConnectionDriver,
  optionName: string,
): number | undefined {
  if (driver !== "bun-sql") return undefined;
  return positiveNumber(options[optionName]);
}

function errorProp(err: unknown, name: string): unknown {
  return isHandleLike(err) ? err[name] : undefined;
}

// Deliberately excludes SQL text and parameters: app SQL can carry PII.
export function describeClosedConnectionFailure(
  raw: unknown,
  err: unknown,
  attempts: number,
): Record<string, unknown> | undefined {
  if (!isClosedConnectionError(err)) return undefined;
  const driver = driverOf(raw);
  const rawOptions = isHandleLike(raw) ? raw["options"] : undefined;
  const options = isHandleLike(rawOptions) ? rawOptions : {};
  return {
    driver,
    pooled: isPooledClient(raw),
    attempts,
    poolMax: positiveNumber(options["max"]),
    idleTimeoutMs: timeoutOptionMs(options, driver, "idleTimeout"),
    maxLifetimeMs: timeoutOptionMs(options, driver, "maxLifetime"),
    connectionTimeoutMs: timeoutOptionMs(options, driver, "connectionTimeout"),
    errorName: errorProp(err, "name"),
    errorCode: extractPgError(err)?.code ?? errorProp(err, "code"),
    errorErrno: errorProp(err, "errno"),
    errorMessage: errorProp(err, "message"),
  };
}

export type ClosedConnectionContext = { readonly operation: string; readonly table?: string };

export function logClosedConnection(
  raw: unknown,
  err: unknown,
  attempts: number,
  context?: ClosedConnectionContext,
): void {
  const failure = describeClosedConnectionFailure(raw, err, attempts);
  // skip: not a closed-connection error, nothing to diagnose
  if (!failure) return;
  // Request identity lets this line be joined to the route's `handler failed` log.
  const request = requestContext.get();
  closedConnectionLog.warn("closed connection surfaced", {
    ...failure,
    ...context,
    requestId: request?.requestId,
    correlationId: request?.correlationId,
    handler: request?.handler,
  });
}

const DEFAULT_POOL_MAX = 10;

export function poolMaxOf(raw: unknown): number {
  const max = propertyOf(propertyOf(raw, "options"), "max");
  return typeof max === "number" && Number.isInteger(max) && max > 0 ? max : DEFAULT_POOL_MAX;
}

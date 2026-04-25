import type { KumikoError } from "./kumiko-error";

// Wire format every 4xx/5xx response must match. The API routes use this
// verbatim; keep it stable — the client SDK keys off these field names.
export type ErrorResponseBody = {
  readonly error: {
    readonly code: string;
    readonly i18nKey: string;
    readonly i18nParams?: Readonly<Record<string, unknown>>;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly timestamp: string;
  };
};

// InternalError deliberately omits `details` from the response in production,
// because that field often carries the internal cause. The log still has
// everything (see buildErrorLog).
//
// In dev/test the cause is exposed in the response body to make debugging
// possible — without this, a crash in a handler comes back as a bare
// "internal error" and developers have to add try/catch + UnprocessableError
// just to see what went wrong (real footgun, not theoretical). The exposure
// is gated on NODE_ENV !== "production" so a misconfigured prod deploy
// doesn't leak stack traces over the wire.
const CODES_WITHOUT_CLIENT_DETAILS = new Set(["internal_error"]);

const isProductionEnv = (): boolean => process.env["NODE_ENV"] === "production";

// Snapshot of the cause chain (top-most error only) suitable for inclusion
// in dev-mode error responses. Stack is truncated to keep the body small.
type DevCauseDetail = {
  readonly causeName?: string;
  readonly causeMessage?: string;
  readonly causeStack?: string;
};

function devCauseDetail(cause: unknown): DevCauseDetail | undefined {
  if (!(cause instanceof Error)) return undefined;
  return {
    causeName: cause.name,
    causeMessage: cause.message,
    ...(cause.stack && { causeStack: cause.stack.split("\n").slice(0, 8).join("\n") }),
  };
}

export function serializeError(err: KumikoError, requestId?: string): ErrorResponseBody {
  const stripped = CODES_WITHOUT_CLIENT_DETAILS.has(err.code) && isProductionEnv();
  const exposeDeclaredDetails = err.details !== undefined && !stripped;

  // For internal_error in dev/test, surface the cause chain so the
  // response body has something useful instead of "internal error".
  // Priority: declared details (if any) win over the cause snapshot —
  // a hand-set details on InternalError should not be replaced.
  const detailsForResponse = (() => {
    if (exposeDeclaredDetails) return err.details;
    if (CODES_WITHOUT_CLIENT_DETAILS.has(err.code) && !isProductionEnv()) {
      return devCauseDetail(err.cause);
    }
    return undefined;
  })();

  return {
    error: {
      code: err.code,
      i18nKey: err.i18nKey,
      ...(err.i18nParams && { i18nParams: err.i18nParams }),
      message: err.message,
      ...(detailsForResponse !== undefined && { details: detailsForResponse }),
      ...(requestId && { requestId }),
      timestamp: new Date().toISOString(),
    },
  };
}

// Full forensic shape — stack, cause chain, details — meant for the log
// emitter. Callers should pipe this through a sensitive-value filter before it
// leaves the process (out of scope for v1).
export type ErrorLogEntry = {
  readonly name: string;
  readonly code: string;
  readonly httpStatus: number;
  readonly message: string;
  readonly i18nKey: string;
  readonly details?: unknown;
  readonly stack?: string;
  readonly cause?: CauseSnapshot;
};

export function buildErrorLog(err: KumikoError): ErrorLogEntry {
  return {
    name: err.name,
    code: err.code,
    httpStatus: err.httpStatus,
    message: err.message,
    i18nKey: err.i18nKey,
    ...(err.details !== undefined && { details: err.details }),
    ...(err.stack && { stack: err.stack }),
    ...(err.cause !== undefined && { cause: serializeCause(err.cause) }),
  };
}

// Recursive cause snapshot — follows error.cause.cause... until the chain
// ends or a non-Error appears. Hard cap at 10 levels to avoid pathological
// cyclic cause chains hanging the serializer.
type CauseSnapshot = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: CauseSnapshot;
};

const MAX_CAUSE_DEPTH = 10;

function serializeCause(cause: unknown, depth = 0): CauseSnapshot {
  if (depth >= MAX_CAUSE_DEPTH) {
    return { name: "CauseChainTruncated", message: `depth >= ${MAX_CAUSE_DEPTH}` };
  }
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.stack && { stack: cause.stack }),
      ...(cause.cause !== undefined && { cause: serializeCause(cause.cause, depth + 1) }),
    };
  }
  return { name: "NonError", message: String(cause) };
}

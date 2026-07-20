import type {
  WriteErrorInfo,
  WriteFailure,
} from "@cosmicdrift/kumiko-types/write-error-info-types";
import { NotFoundError, UnprocessableError } from "./classes";
import { KumikoError } from "./kumiko-error";
import { FrameworkReasons } from "./reasons";
import { buildInvalidTransitionDetails } from "./transition-details";

// Legacy types — re-exported for callers still importing this module directly.
export * from "@cosmicdrift/kumiko-types/write-error-info-types";

// Convenience for call sites that return a failed WriteResult. Keeps the
// pattern `return writeFailure(new NotFoundError(...))` compact so handlers
// and the CrudExecutor don't need to spell out the shape each time.
export function writeFailure(err: KumikoError): WriteFailure {
  return { isSuccess: false, error: toWriteErrorInfo(err) };
}

// Focused convenience for the two most common handler failures: "X not found"
// (typed 404) and "business rule violated: REASON" (typed 422 with the reason
// string surfaced in details.reason). Reach for the concrete classes when you
// need richer payload — these two cover the bulk of handler code.
// @wrapper-known error-helper
export function failNotFound(entity: string, id?: number | string): WriteFailure {
  return writeFailure(new NotFoundError(entity, id));
}

// @wrapper-known error-helper
export function failUnprocessable(
  reason: string,
  details?: Readonly<Record<string, unknown>>,
): WriteFailure {
  return writeFailure(new UnprocessableError(reason, details ? { details } : undefined));
}

/**
 * Convenience für State-Transition-Rejects: produces a WriteFailure mit
 * reason="invalid_transition" + strukturiertem `from`/`to`/`allowed`-
 * Detail-Block + lesbarer message. Pattern hat sich in publicstatus-
 * Maintenance + bestehenden state-machine-Helpers wiederholt — Helper
 * sammelt das in einem Aufruf statt drei manuelle Detail-Felder.
 *
 * `allowed` ist typisch `MAINTENANCE_TRANSITIONS.allowedFrom(from)`.
 */
export function failTransition(from: string, to: string, allowed: readonly string[]): WriteFailure {
  return writeFailure(
    new UnprocessableError(FrameworkReasons.invalidTransition, {
      i18nKey: "errors.invalidTransition",
      details: buildInvalidTransitionDetails(from, to, allowed),
    }),
  );
}

export function toWriteErrorInfo(err: KumikoError): WriteErrorInfo {
  // In dev/test surface the cause-snapshot through `details` so the
  // HTTP response carries something useful. Without this, internal_error
  // crashes round-trip through WriteErrorInfo (no cause field) and come
  // back to the client as a bare `{ message: "internal error" }` —
  // identical user-experience to a misconfigured prod, just slower
  // because the dev has to add try/catch + console.log to find the
  // actual stack. Same gating as serializeError: NODE_ENV !== production.
  const causeDetails =
    err.details === undefined && err.code === "internal_error" && err.cause instanceof Error
      ? process.env["NODE_ENV"] !== "production"
        ? {
            causeName: err.cause.name,
            causeMessage: err.cause.message,
            ...(err.cause.stack && {
              causeStack: err.cause.stack.split("\n").slice(0, 8).join("\n"),
            }),
          }
        : undefined
      : undefined;
  const effectiveDetails = err.details ?? causeDetails;
  return {
    code: err.code,
    httpStatus: err.httpStatus,
    i18nKey: err.i18nKey,
    message: err.message,
    ...(err.i18nParams && { i18nParams: err.i18nParams }),
    ...(effectiveDetails !== undefined && { details: effectiveDetails }),
  };
}

// Reconstitutes an error from WriteErrorInfo so command() (throw-based) can
// keep raising a KumikoError after the batch returned structural data. The
// concrete subclass identity is lost here — callers can still read code /
// httpStatus / details but `instanceof NotFoundError` won't work. That's OK:
// the HTTP layer keys off code + httpStatus, not class identity.
export function reraiseAsKumikoError(info: WriteErrorInfo): KumikoError {
  return new ReraisedError(info);
}

class ReraisedError extends KumikoError {
  readonly code: string;
  readonly httpStatus: number;

  constructor(info: WriteErrorInfo) {
    super({
      message: info.message,
      i18nKey: info.i18nKey,
      ...(info.i18nParams && { i18nParams: info.i18nParams }),
      ...(info.details !== undefined && { details: info.details }),
    });
    this.code = info.code;
    this.httpStatus = info.httpStatus;
  }
}

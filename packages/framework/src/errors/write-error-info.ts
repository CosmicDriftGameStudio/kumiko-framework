import { NotFoundError, UnprocessableError } from "./classes";
import { KumikoError } from "./kumiko-error";
import { FrameworkReasons } from "./reasons";

// Plain, JSON-serializable snapshot of a KumikoError for use on the write-path
// (WriteResult.error, BatchResult.error). The dispatcher stores results under
// an idempotency key — a KumikoError instance wouldn't round-trip through
// JSON, so we keep structural data only and rebuild the instance on demand
// via reraiseAsKumikoError when we need to throw upstream again.
export type WriteErrorInfo = {
  readonly code: string;
  readonly httpStatus: number;
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly details?: unknown;
};

// The failure half of WriteResult — `{ isSuccess: false } + error`. Named
// so the three write-failure factories below and WriteResult share one
// shape instead of restating it. Not generic: the error carries zero data,
// so there's nothing for the caller to narrow.
export type WriteFailure = {
  readonly isSuccess: false;
  readonly error: WriteErrorInfo;
};

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
export function failNotFound(entity: string, id?: number | string): WriteFailure {
  return writeFailure(new NotFoundError(entity, id));
}

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
      details: {
        from,
        to,
        allowed,
        message: `Invalid transition: "${from}" → "${to}". Allowed from "${from}": ${
          allowed.length > 0 ? allowed.join(", ") : "none"
        }`,
      },
    }),
  );
}

export function toWriteErrorInfo(err: KumikoError): WriteErrorInfo {
  return {
    code: err.code,
    httpStatus: err.httpStatus,
    i18nKey: err.i18nKey,
    message: err.message,
    ...(err.i18nParams && { i18nParams: err.i18nParams }),
    ...(err.details !== undefined && { details: err.details }),
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

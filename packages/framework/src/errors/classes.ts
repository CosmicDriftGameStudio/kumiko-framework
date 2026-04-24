import { type ErrorOpts, KumikoError } from "./kumiko-error";

// Per-field validation issue. Shared shape between Zod-derived and
// hook-derived validation errors so the client sees one list.
export type ValidationFieldIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

export type ValidationDetails = {
  readonly fields: readonly ValidationFieldIssue[];
};

export class ValidationError extends KumikoError {
  readonly code = "validation_error";
  readonly httpStatus = 400;

  constructor(details: ValidationDetails, opts?: Pick<ErrorOpts, "i18nKey" | "cause">) {
    // The wire `message` stays a short human-readable fallback — Zod's own
    // `error.message` is a multi-line JSON blob that would look awful in any
    // UI. Per-field details belong in `details.fields` (structured, i18nable);
    // the full ZodError is preserved in `cause` for forensics in the log.
    super({
      message: "Validation failed",
      i18nKey: opts?.i18nKey ?? "errors.validation.failed",
      details,
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

// Raised by the dispatcher when a handler belongs to a feature that is
// globally disabled. Separate from AccessDenied so clients can distinguish
// "this feature is off" (retry pointless until ops flips it on) from
// "you don't have permission" (potentially retryable with a different user).
export type FeatureDisabledDetails = {
  readonly reason: "feature_disabled";
  readonly feature: string;
  readonly handler: string;
};

export class FeatureDisabledError extends KumikoError {
  readonly code = "feature_disabled";
  readonly httpStatus = 403;

  constructor(feature: string, handler: string, opts?: Pick<ErrorOpts, "cause">) {
    super({
      message: `feature ${feature} is disabled`,
      i18nKey: "errors.feature.disabled",
      i18nParams: { feature },
      details: { reason: "feature_disabled", feature, handler } satisfies FeatureDisabledDetails,
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

export class AccessDeniedError extends KumikoError {
  readonly code = "access_denied";
  readonly httpStatus = 403;

  constructor(opts?: Pick<ErrorOpts, "message" | "i18nKey" | "i18nParams" | "details" | "cause">) {
    super({
      message: opts?.message ?? "access denied",
      i18nKey: opts?.i18nKey ?? "errors.access.denied",
      ...(opts?.i18nParams && { i18nParams: opts.i18nParams }),
      ...(opts?.details !== undefined && { details: opts.details }),
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

export type NotFoundDetails = {
  readonly entity: string;
  readonly id?: string;
};

export class NotFoundError extends KumikoError {
  readonly code = "not_found";
  readonly httpStatus = 404;

  constructor(
    entity: string,
    id?: string | number,
    opts?: Pick<ErrorOpts, "i18nKey" | "i18nParams" | "cause">,
  ) {
    const idStr = id !== undefined ? String(id) : undefined;
    // The reason string follows `<snake_entity>_not_found` — keeps a stable,
    // client-friendly tag that survives wire serialization even if the entity
    // name is later renamed for display purposes.
    const reason = `${toSnake(entity)}_not_found`;
    const details: NotFoundDetails & { reason: string } = { reason, entity, id: idStr };
    super({
      message: idStr !== undefined ? `${entity} ${idStr} not found` : `${entity} not found`,
      i18nKey: opts?.i18nKey ?? "errors.notFound",
      i18nParams: { entity, id: idStr, ...opts?.i18nParams },
      details,
      cause: opts?.cause,
    });
  }
}

function toSnake(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

// Generic 409. Features that need a narrower shape should subclass (see
// VersionConflictError) — this way the HTTP layer stays uniform while callers
// can still instanceof on the concrete subtype in handlers.
export class ConflictError extends KumikoError {
  // Widened to `string` so subclasses (VersionConflictError) can refine the
  // value without TS blocking the override. The base class still enforces
  // "some code is set"; concrete classes pick their own literal.
  readonly code: string = "conflict";
  readonly httpStatus = 409;

  constructor(opts?: Pick<ErrorOpts, "message" | "i18nKey" | "i18nParams" | "details" | "cause">) {
    super({
      message: opts?.message ?? "conflict",
      i18nKey: opts?.i18nKey ?? "errors.conflict",
      ...(opts?.i18nParams && { i18nParams: opts.i18nParams }),
      ...(opts?.details !== undefined && { details: opts.details }),
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

export type VersionConflictDetails = {
  readonly entityId: number | string;
  readonly expectedVersion: number;
  readonly currentVersion: number;
};

export class VersionConflictError extends ConflictError {
  override readonly code: string = "version_conflict";

  constructor(details: VersionConflictDetails, opts?: Pick<ErrorOpts, "i18nKey" | "cause">) {
    super({
      message: `version conflict for entity ${details.entityId}`,
      i18nKey: opts?.i18nKey ?? "errors.versionConflict",
      details,
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

// Business-rule violation. The human-readable reason lives in details.reason
// so the client can key off it without overloading the top-level code.
export type UnprocessableOpts = Pick<ErrorOpts, "i18nKey" | "i18nParams" | "cause"> & {
  readonly details?: Readonly<Record<string, unknown>>;
};

export class UnprocessableError extends KumikoError {
  readonly code = "unprocessable";
  readonly httpStatus = 422;

  constructor(reason: string, opts?: UnprocessableOpts) {
    super({
      message: `unprocessable: ${reason}`,
      i18nKey: opts?.i18nKey ?? "errors.unprocessable",
      ...(opts?.i18nParams && { i18nParams: opts.i18nParams }),
      details: { reason, ...opts?.details },
      ...(opts?.cause && { cause: opts.cause }),
    });
  }
}

// Auto-wrap target for unexpected throws. Never exposes .details to the client
// — the serializer drops it. Stack + cause live in the log only.
export class InternalError extends KumikoError {
  readonly code = "internal_error";
  readonly httpStatus = 500;

  constructor(opts?: Pick<ErrorOpts, "message" | "i18nKey" | "i18nParams" | "details" | "cause">) {
    super({
      message: opts?.message ?? "internal error",
      i18nKey: opts?.i18nKey ?? "errors.internal",
      ...(opts?.i18nParams !== undefined && { i18nParams: opts.i18nParams }),
      ...(opts?.details !== undefined && { details: opts.details }),
      ...(opts?.cause !== undefined && { cause: opts.cause }),
    });
  }
}

// Rate-limit hit. The bucket details (limit, window, current state) live
// in `details` so a client can show "try again in N seconds" without a
// second request. Headers `Retry-After`, `X-RateLimit-*` are filled in
// by the HTTP layer from these same fields.
export type RateLimitDetails = {
  readonly bucket: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAt: string;
};

export class RateLimitError extends KumikoError {
  readonly code = "rate_limited";
  readonly httpStatus = 429;
  readonly details: RateLimitDetails;

  constructor(details: RateLimitDetails, opts?: Pick<ErrorOpts, "i18nKey" | "cause">) {
    super({
      message: `rate limited: ${details.bucket} (limit ${details.limit} per ${details.windowSeconds}s)`,
      i18nKey: opts?.i18nKey ?? "errors.rate_limited",
      details,
      ...(opts?.cause && { cause: opts.cause }),
    });
    this.details = details;
  }
}

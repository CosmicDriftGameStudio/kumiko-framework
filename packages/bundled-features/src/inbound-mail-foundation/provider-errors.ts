// =============================================================================
// Typed errors handled uniformly by the Foundation during polling:
//   InboundAuthError          → status=auth_error, no retry
//   InboundRateLimitError     → abort poll, wait for the next cron tick
//   InboundCursorInvalidError → reset cursor + full resync in the backfill
//                               window; deduplication handles duplicates
//   InboundTransientError     → job retry (retries: 3, exponential)
// =============================================================================
//
// Use a `kind` discriminant instead of instanceof: plugins and the Foundation
// may run in separate bundles (dual-package-hazard), and instanceof is
// unreliable across realm or package-copy boundaries.

export class InboundAuthError extends Error {
  readonly kind = "inbound-auth-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundAuthError";
  }
}

/** The credential secret is not there (yet). Still an auth error for a regular poll; a sync woken
 *  right after connect treats it as "not ready" because the secret is written after the account. */
export class InboundCredentialNotStoredError extends InboundAuthError {
  readonly credentialNotStored = true as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundCredentialNotStoredError";
  }
}

export class InboundRateLimitError extends Error {
  readonly kind = "inbound-rate-limit-error" as const;
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "InboundRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class InboundCursorInvalidError extends Error {
  readonly kind = "inbound-cursor-invalid-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundCursorInvalidError";
  }
}

export class InboundTransientError extends Error {
  readonly kind = "inbound-transient-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "InboundTransientError";
  }
}

export function isInboundAuthError(e: unknown): e is InboundAuthError {
  return e instanceof Error && "kind" in e && e.kind === "inbound-auth-error";
}
export function isInboundCredentialNotStoredError(
  e: unknown,
): e is InboundCredentialNotStoredError {
  return isInboundAuthError(e) && "credentialNotStored" in e && e.credentialNotStored === true;
}
export function isInboundRateLimitError(e: unknown): e is InboundRateLimitError {
  return e instanceof Error && "kind" in e && e.kind === "inbound-rate-limit-error";
}
export function isInboundCursorInvalidError(e: unknown): e is InboundCursorInvalidError {
  return e instanceof Error && "kind" in e && e.kind === "inbound-cursor-invalid-error";
}
export function isInboundTransientError(e: unknown): e is InboundTransientError {
  return e instanceof Error && "kind" in e && e.kind === "inbound-transient-error";
}

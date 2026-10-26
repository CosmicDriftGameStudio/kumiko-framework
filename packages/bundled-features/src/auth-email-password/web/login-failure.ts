// Pure (no DOM, no renderer): shared by the SPA clients and the static login, which must stay
// importable from a plain script.

// Reason codes the login handler is known to emit (login-screen.tsx's reasonToKey maps every one
// of these to an i18n key). The server can also send a reason this client does not know yet
// (rolling deploys, a new enforcement policy), so consumers type `KnownLoginFailureReason |
// (string & {})`: autocomplete on the known set, no collapse to plain `string`.
export type KnownLoginFailureReason =
  | "invalid_credentials"
  | "no_membership"
  | "account_locked"
  | "email_not_verified"
  | "rate_limited"
  | "invalid_body"
  | "mfa_not_supported"
  | "mfa_setup_required";

export type LoginFailure = {
  readonly reason: KnownLoginFailureReason | (string & {});
  readonly message?: string;
  readonly retryAfterSeconds?: number;
};

// Only a non-negative integer second count is usable; anything else is treated as absent.
export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  if (!/^\d+$/.test(header)) return undefined;
  return Number(header);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// The server sends `error` either as a string ("invalid_body") or as a structured object; this
// extracts the most descriptive reason, falling back to the endpoint's generic one.
export function failureFromErrorField(error: unknown, fallbackReason: string): LoginFailure {
  if (typeof error === "string") return { reason: error };
  const fields = isRecord(error) ? error : {};
  const details = isRecord(fields["details"]) ? fields["details"] : {};
  const reason =
    stringOrUndefined(details["reason"]) ?? stringOrUndefined(fields["code"]) ?? fallbackReason;
  const message = stringOrUndefined(fields["message"]);
  const retry = details["retryAfterSeconds"];
  return {
    reason,
    ...(message !== undefined && { message }),
    ...(typeof retry === "number" && { retryAfterSeconds: retry }),
  };
}

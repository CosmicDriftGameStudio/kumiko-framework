// Browser-side wrappers around /api/auth/* using cookie transport: the JWT
// lives in the HttpOnly kumiko_auth cookie, while the Double-Submit CSRF
// token lives in the JS-readable kumiko_csrf cookie. Every state-changing
// request echoes the CSRF token via X-CSRF-Token; otherwise the server
// rejects it with csrf_token_missing.
//
// dispatcher-live uses the same readCsrfToken helper; reusing it here keeps
// the cookie and header constants from diverging.

import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-renderer/live";
import {
  failureFromErrorField,
  type LoginFailure,
  parseRetryAfterSeconds,
} from "./login-failure.ts";

export type { KnownLoginFailureReason, LoginFailure } from "./login-failure.ts";
export { parseRetryAfterSeconds };

export type TenantSummary = {
  readonly tenantId: string;
  readonly roles: readonly string[];
  /** Display name from /auth/tenants; absent only for app-owned membership
   * queries without tenantName enrichment. */
  readonly name?: string;
  readonly key?: string;
};

export type LoginRequest = {
  readonly email: string;
  readonly password: string;
};

export type LoginResponse = {
  readonly token: string;
  readonly user: {
    readonly id: string;
    readonly tenantId: string;
    readonly roles: readonly string[];
  };
  // Present only when the server's auth.postAuthLanding resolver returned a
  // valid path — see auth-routes.ts. Screens prefer this over loggedInHref.
  readonly landingPath?: string;
};

export function csrfHeader(): Record<string, string> {
  const token = readCsrfToken();
  return token !== undefined ? { [CSRF_HEADER_NAME]: token } : {};
}

// Thrown by fetchTenants/fetchCurrentUser on a non-401 error status, distinguishable from a plain network failure by its status field.
export class AuthRequestError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, status: number, retryAfterSeconds: number | undefined) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// LoginResult mirrors the two-step login contract auth-routes.ts owns: a
// straight success, an MFA challenge (auth-mfa mints the token), an
// MFA-setup-required block (enforcement policy blocks an unenrolled user),
// or a plain failure. One discriminated union, not `{ok}` booleans, because
// callers branch on 4 arms.
export type LoginResult =
  | { readonly kind: "success"; readonly data: LoginResponse }
  | { readonly kind: "mfa-challenge"; readonly challengeToken: string }
  | { readonly kind: "mfa-setup-required"; readonly preauthSetupToken: string }
  | { readonly kind: "failure"; readonly error: LoginFailure };

export function toLoginResponse(
  token: string,
  user: LoginResponse["user"],
  landingPath: unknown,
): LoginResponse {
  return typeof landingPath === "string" ? { token, user, landingPath } : { token, user };
}

// POST /api/auth/login. Success → token + user; MFA-enrolled user → a
// challenge token the caller completes via auth-mfa's verify screen;
// unenrolled user blocked by enforcement policy → mfa-setup-required;
// otherwise a structured failure with reason (invalid_credentials,
// account_locked, no_membership, rate_limited). The server sets cookies
// automatically on any 200.
export async function login(req: LoginRequest): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 429) {
    return { kind: "failure", error: { reason: "rate_limited" } };
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json().catch(() => ({}))) as {
    isSuccess?: boolean;
    token?: string;
    user?: LoginResponse["user"];
    mfaRequired?: boolean;
    challengeToken?: string;
    mfaSetupRequired?: boolean;
    preauthSetupToken?: string;
    landingPath?: string;
    error?: unknown;
  };
  if (body.isSuccess === true) {
    if (body.mfaRequired === true && typeof body.challengeToken === "string") {
      return { kind: "mfa-challenge", challengeToken: body.challengeToken };
    }
    if (body.mfaSetupRequired === true) {
      // Older servers / mounts may set the flag without minting a preauth token —
      // surface an explicit failure (login-screen maps mfa_setup_required) instead
      // of falling through to generic login_failed.
      if (typeof body.preauthSetupToken === "string") {
        return { kind: "mfa-setup-required", preauthSetupToken: body.preauthSetupToken };
      }
      return { kind: "failure", error: { reason: "mfa_setup_required" } };
    }
    if (body.token !== undefined && body.user !== undefined) {
      return { kind: "success", data: toLoginResponse(body.token, body.user, body.landingPath) };
    }
  }
  return { kind: "failure", error: failureFromErrorField(body.error, "login_failed") };
}

// POST /api/auth/logout. The server revokes the session when
// sessionRevoker is wired and clears the cookies. A navigation refresh
// afterward ensures that all caches (React state, query cache) return to
// an unauthenticated state—the simplest way to restore a clean baseline.
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
  });
}

// Shared failure type for the four token-flow endpoints (request-
// password-reset, reset-password, request-email-verification, verify-
// email). The server collapses all token-verification errors (malformed,
// bad signature, expired) into one code per flow to prevent enumeration;
// the UI maps reason to an i18n key. Rate limits (429) pass through as
// reason "rate_limited" with retryAfterSeconds, using the same shape as
// LoginFailure so apps can map errors uniformly.
export type AuthTokenFailure = {
  readonly reason: string;
  readonly retryAfterSeconds?: number;
};

// Backward-compatible aliases for the old type names, so code importing
// `ResetPasswordFailure` or `VerifyEmailFailure` continues to work without
// changes. New code should use `AuthTokenFailure` directly.
export type ResetPasswordFailure = AuthTokenFailure;
export type VerifyEmailFailure = AuthTokenFailure;

// Parse 4xx/5xx responses into AuthTokenFailure. 429 uses a dedicated
// reason so the UI can display a retry hint.
async function parseTokenFailure(res: Response): Promise<AuthTokenFailure> {
  if (res.status === 429) {
    // @cast-boundary engine-payload — the server sends details.retryAfterSeconds for 429
    const body = (await res.json().catch(() => ({}))) as {
      error?: { details?: { retryAfterSeconds?: number } };
    };
    const retry = body.error?.details?.retryAfterSeconds;
    return { reason: "rate_limited", ...(retry !== undefined && { retryAfterSeconds: retry }) };
  }
  // @cast-boundary engine-payload — server-side schema-validated body
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; details?: { reason?: string } };
  };
  const reason = body.error?.details?.reason ?? body.error?.code ?? "unknown";
  return { reason };
}

// POST /api/auth/request-password-reset. 200 silent-success: even if the
// email doesn't exist, the caller sees `{ ok: true }` — no account
// enumeration. Server only triggers the mail internally when a user is
// found. 429 → typed rate-limit failure. 5xx → unknown-error.
export async function requestPasswordReset(
  email: string,
  returnTo?: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/request-password-reset", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email, ...(returnTo !== undefined && { returnTo }) }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/reset-password. The token comes from the URL and the
// request includes the new password. On 422, the server collapses all
// token-verification errors (malformed, bad signature, expired) into the
// single code `invalid_reset_token` to prevent enumeration. Zod validation
// failures (newPassword < 8) use a separate 4xx code, "validation_failed".
// The UI maps reason to an i18n key.
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token, newPassword }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/request-email-verification. Same silent-success
// semantics as request-password-reset. 429 → rate-limit failure.
export async function requestEmailVerification(
  email: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/request-email-verification", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/verify-email. VerifyEmailScreen submits this automatically
// after parsing `?token=...`. The server collapses all verification failures
// into `invalid_verification_token` to prevent enumeration, as with reset.
export async function verifyEmail(
  token: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/request-account-unlock. Same silent-success semantics as
// request-password-reset. 429 → rate-limit failure.
export async function requestAccountUnlock(
  email: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/request-account-unlock", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/confirm-account-unlock. Auto-submitted by
// ConfirmAccountUnlockScreen after parsing `?token=...`. Server collapses
// every verify failure into `invalid_unlock_token` (anti-enumeration,
// parallel to reset/verify). Only clears the Redis lockout state, no
// entity write.
export async function confirmAccountUnlock(
  token: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/confirm-account-unlock", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/signup-request. Always returns 200 to prevent enumeration;
// the response does not reveal whether the email is already registered. The
// server sends an activation email to the address; following its link takes
// the user to /signup/complete?token=… to set a password.
export async function requestSignup(
  email: string,
  // Cross-device try-first handover: forwards a row-bound tenant-handover
  // grant so the server can verify + rebind it to the signup token. The grant never
  // travels any further than this request — never in the URL, the mail,
  // or the confirm response.
  handover?: { readonly entityType: string; readonly token: string },
  returnTo?: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/signup-request", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({
      email,
      ...(handover !== undefined && { handover }),
      ...(returnTo !== undefined && { returnTo }),
    }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/signup-confirm. On success the server sets the auth cookies
// (auto-login) and returns the tenantKey for the post-signup redirect, unless
// the MFA gate applies (kind "mfa-pending", no session). 422 invalid_signup_token
// for an expired or unknown token.
export type SignupConfirmSuccess = {
  readonly user: { readonly id: string; readonly tenantId: string; readonly roles: string[] };
  readonly tenantKey: string;
  // Present only when a bound handover grant existed and its claim
  // succeeded — see signup-confirm.write.ts.
  readonly handover?: { readonly entityType: string; readonly id: string };
  // Present only when the server's auth.postAuthLanding resolver returned a
  // valid path — see auth-routes.ts.
  readonly landingPath?: string;
};

// mfa-pending: account exists but the server issued no session because the
// new roles require a second factor — the user must sign in to enroll.
// landingPath is where the signup would have landed; the login that follows
// should end there.
export type SignupConfirmResult =
  | ({ readonly kind: "signed-in" } & SignupConfirmSuccess)
  | { readonly kind: "mfa-pending"; readonly landingPath?: string };

export async function confirmSignup(
  token: string,
  password: string,
): Promise<{ ok: true; data: SignupConfirmResult } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/signup-confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token, password }),
  });
  if (res.ok) {
    // @cast-boundary engine-payload
    const body = (await res.json()) as SignupConfirmSuccess & {
      readonly mfaRequired?: boolean;
      readonly mfaSetupRequired?: boolean;
    };
    if (body.mfaRequired === true || body.mfaSetupRequired === true) {
      return {
        ok: true,
        data: {
          kind: "mfa-pending",
          ...(typeof body.landingPath === "string" && { landingPath: body.landingPath }),
        },
      };
    }
    return { ok: true, data: { kind: "signed-in", ...body } };
  }
  return { ok: false, error: await parseTokenFailure(res) };
}

// GET /api/auth/tenants. Returns the current user's memberships; the server
// returns 401 when the cookie is missing or expired.
export async function fetchTenants(): Promise<{
  readonly tenants: readonly TenantSummary[];
  readonly activeTenantId: string;
} | null> {
  const res = await fetch("/api/auth/tenants", {
    method: "GET",
    credentials: "same-origin",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new AuthRequestError(
      `auth/tenants failed: ${res.status}`,
      res.status,
      parseRetryAfterSeconds(res.headers.get("Retry-After")),
    );
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  return (await res.json()) as {
    tenants: readonly TenantSummary[];
    activeTenantId: string;
  };
}

// POST /api/auth/switch-tenant. Mints a new JWT for the target tenant and
// rotates both cookies. Returns 400 for already_in_tenant or
// tenant_switch_not_available, and 403 for not_a_member.
export async function switchTenant(tenantId: string): Promise<void> {
  const res = await fetch("/api/auth/switch-tenant", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`switch-tenant failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

// POST /api/query → user:query:user:me. Returns profile data (email,
// displayName) for the UserMenu in the top bar. A 401 for a missing or
// expired cookie is interpreted by SessionProvider as signed out.
//
// globalRoles are tenant-independent user roles (for example, SystemAdmin)
// from users.roles. They are merged into the JWT with tenant-membership
// roles, but the JWT is HttpOnly and unreadable by JavaScript, so the client
// must fetch the global roles separately from the user row for navigation
// filtering.
export type CurrentUserProfile = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale?: string;
  /** Effective IANA zone (user override, else tenant, else UTC). */
  readonly effectiveTimeZone?: string;
  readonly globalRoles: readonly string[];
};

export async function fetchCurrentUser(): Promise<CurrentUserProfile | null> {
  const res = await fetch("/api/query", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ type: "user:query:user:me", payload: {} }),
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new AuthRequestError(
      `user:me failed: ${res.status}`,
      res.status,
      parseRetryAfterSeconds(res.headers.get("Retry-After")),
    );
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json()) as {
    data?: {
      id: string;
      email: string;
      displayName: string;
      locale?: string;
      effectiveTimeZone?: string;
      // JSON-encoded string[]; see userEntity.roles. Defaults to "[]" when
      // there are no global roles.
      roles?: string;
    };
  };
  if (!body.data) return null;
  return {
    id: body.data.id,
    email: body.data.email,
    displayName: body.data.displayName,
    ...(body.data.locale !== undefined && { locale: body.data.locale }),
    ...(body.data.effectiveTimeZone !== undefined && {
      effectiveTimeZone: body.data.effectiveTimeZone,
    }),
    globalRoles: parseRoles(body.data.roles),
  };
}

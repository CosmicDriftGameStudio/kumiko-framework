// @runtime client
// Browser-Seite von POST /api/auth/mfa/verify — completes the two-step
// login LoginScreen started when the server responded mfaRequired. Same
// fetch/CSRF pattern as auth-email-password's login() (pre-session, no
// csrfHeader() — there's no session yet to protect). Response shape is
// byte-identical to /auth/login's ({isSuccess, token, user} | {isSuccess:
// false, error}) since auth-routes.ts mints via the same
// mintSessionAndRespond() for both routes.

// kumiko-lint-ignore cross-feature-import client-only types, the feature's server barrel has no web/ re-export
import type { LoginFailure, LoginResponse } from "../../auth-email-password/web";

export type MfaVerifyResult =
  | { readonly kind: "success"; readonly data: LoginResponse }
  | { readonly kind: "failure"; readonly error: LoginFailure };

export async function verifyMfaChallenge(
  challengeToken: string,
  code: string,
): Promise<MfaVerifyResult> {
  const res = await fetch("/api/auth/mfa/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken, code }),
  });
  if (res.status === 429) {
    return { kind: "failure", error: { reason: "rate_limited" } };
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json().catch(() => ({}))) as {
    isSuccess?: boolean;
    token?: string;
    user?: LoginResponse["user"];
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
  };
  if (body.isSuccess === true && body.token !== undefined && body.user !== undefined) {
    return { kind: "success", data: { token: body.token, user: body.user } };
  }
  const err = body.error;
  if (typeof err === "string") {
    return { kind: "failure", error: { reason: err } };
  }
  const reason = err?.details?.reason ?? err?.code ?? "mfa_verify_failed";
  const retry = err?.details?.retryAfterSeconds;
  return {
    kind: "failure",
    error: {
      reason,
      ...(err?.message !== undefined && { message: err.message }),
      ...(retry !== undefined && { retryAfterSeconds: retry }),
    },
  };
}

export type MfaSetupPreauthStart = {
  readonly setupToken: string;
  readonly otpauthUri: string;
  readonly recoveryCodes: readonly string[];
};

export type MfaSetupPreauthStartResult =
  | { readonly kind: "success"; readonly data: MfaSetupPreauthStart }
  | { readonly kind: "failure"; readonly error: LoginFailure };

// Browser-Seite von POST /api/auth/mfa/preauth-enable-start — lets a user
// blocked at login by MFA enforcement generate a TOTP secret/QR without a
// session, using the preauthSetupToken login()'s mfa-setup-required result
// carries. No JWT/cookie here (see auth-routes.ts's route comment) — the
// response's setupToken is consumed by confirmMfaSetupPreauth below.
export async function startMfaSetupPreauth(
  preauthSetupToken: string,
  accountLabel: string,
): Promise<MfaSetupPreauthStartResult> {
  const res = await fetch("/api/auth/mfa/preauth-enable-start", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preauthSetupToken, accountLabel }),
  });
  if (res.status === 429) {
    return { kind: "failure", error: { reason: "rate_limited" } };
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json().catch(() => ({}))) as {
    isSuccess?: boolean;
    setupToken?: string;
    otpauthUri?: string;
    recoveryCodes?: readonly string[];
    error?: { code?: string; message?: string; details?: { reason?: string } } | string;
  };
  if (
    body.isSuccess === true &&
    body.setupToken !== undefined &&
    body.otpauthUri !== undefined &&
    body.recoveryCodes !== undefined
  ) {
    return {
      kind: "success",
      data: {
        setupToken: body.setupToken,
        otpauthUri: body.otpauthUri,
        recoveryCodes: body.recoveryCodes,
      },
    };
  }
  const err = body.error;
  if (typeof err === "string") {
    return { kind: "failure", error: { reason: err } };
  }
  const reason = err?.details?.reason ?? err?.code ?? "setup_failed";
  return {
    kind: "failure",
    error: { reason, ...(err?.message !== undefined && { message: err.message }) },
  };
}

// Browser-Seite von POST /api/auth/mfa/preauth-confirm — completes both
// the enrollment startMfaSetupPreauth began and the login mfa-setup-
// required block. Response shape mirrors /auth/mfa/verify's (mints via
// the same mintSessionAndRespond()), same as verifyMfaChallenge above —
// kept as its own function rather than a shared helper so this file's
// two already-tested request shapes stay independently editable.
export async function confirmMfaSetupPreauth(
  setupToken: string,
  code: string,
): Promise<MfaVerifyResult> {
  const res = await fetch("/api/auth/mfa/preauth-confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupToken, code }),
  });
  if (res.status === 429) {
    return { kind: "failure", error: { reason: "rate_limited" } };
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json().catch(() => ({}))) as {
    isSuccess?: boolean;
    token?: string;
    user?: LoginResponse["user"];
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
  };
  if (body.isSuccess === true && body.token !== undefined && body.user !== undefined) {
    return { kind: "success", data: { token: body.token, user: body.user } };
  }
  const err = body.error;
  if (typeof err === "string") {
    return { kind: "failure", error: { reason: err } };
  }
  const reason = err?.details?.reason ?? err?.code ?? "mfa_setup_confirm_failed";
  const retry = err?.details?.retryAfterSeconds;
  return {
    kind: "failure",
    error: {
      reason,
      ...(err?.message !== undefined && { message: err.message }),
      ...(retry !== undefined && { retryAfterSeconds: retry }),
    },
  };
}

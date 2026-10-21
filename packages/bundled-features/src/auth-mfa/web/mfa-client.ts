// Browser side of POST /api/auth/mfa/verify — completes the two-step
// login that LoginScreen started when the server responded with mfaRequired.
// Uses the same fetch/CSRF pattern as auth-email-password's login(), but runs
// before a session exists, so it does not call csrfHeader(). The response is
// byte-identical to /auth/login's ({isSuccess, token, user} | {isSuccess:
// false, error}) because auth-routes.ts uses mintSessionAndRespond() for both
// routes.

// kumiko-lint-ignore cross-feature-import client-only types, the feature's server barrel has no web/ re-export
import {
  type LoginFailure,
  type LoginResponse,
  toLoginResponse,
} from "../../auth-email-password/web/index.ts";

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
    landingPath?: string;
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
  };
  if (body.isSuccess === true && body.token !== undefined && body.user !== undefined) {
    return {
      kind: "success",
      data: toLoginResponse(body.token, body.user, body.landingPath),
    };
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

// Browser side of POST /api/auth/mfa/preauth-enable-start — lets a user
// blocked at login by MFA enforcement generate a TOTP secret/QR without a
// session, using the preauthSetupToken carried by login()'s
// mfa-setup-required result. No JWT/cookie is issued here (see the route
// comment in auth-routes.ts); the response's
// setupToken is consumed by confirmMfaSetupPreauth below.
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
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
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

// Browser side of POST /api/auth/mfa/preauth-confirm — completes both the
// enrollment started by startMfaSetupPreauth and the login
// mfa-setup-required block. Its response mirrors /auth/mfa/verify's and is
// minted via the same mintSessionAndRespond(). It remains a separate function
// so this file's two already-tested request shapes stay independently
// editable.
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
    landingPath?: string;
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
  };
  if (body.isSuccess === true && body.token !== undefined && body.user !== undefined) {
    return {
      kind: "success",
      data: toLoginResponse(body.token, body.user, body.landingPath),
    };
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

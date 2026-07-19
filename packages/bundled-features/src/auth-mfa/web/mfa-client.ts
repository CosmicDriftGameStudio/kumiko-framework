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

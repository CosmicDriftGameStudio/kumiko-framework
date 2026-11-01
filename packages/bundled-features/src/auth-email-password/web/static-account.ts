// DOM-free account pages for static sites (plain Astro scripts): password reset, e-mail
// verification, invite acceptance and the signup registration status. Same import rules as
// static-login.ts: fetch plus pure logic, nothing that touches `window` at import time.

import { AuthQueries } from "./constants.ts";
import { isRecord } from "./login-failure.ts";
import { isSafeReturnPath } from "./return-path.ts";
import {
  dispatchQuery,
  postJson,
  type StaticRequestOptions,
  type StaticResult,
  staticFailure,
  staticSuccess,
} from "./static-client.ts";

export {
  hrefWithoutUrlToken,
  readUrlToken,
  STATIC_MALFORMED_TOKEN_REASON,
  STATIC_NETWORK_REASON,
  STATIC_RATE_LIMITED_REASON,
  type StaticFailure,
  type StaticRequestOptions,
  type StaticResult,
  type StaticSuccess,
  takeUrlToken,
  type UrlTokenSource,
} from "./static-client.ts";

const UNEXPECTED_RESPONSE_REASON = "unexpected_response";

export type SignupRegistrationStatus = { readonly enabled: boolean };

/** A failed lookup should be read as open: signup-request itself stays the authority. */
export async function fetchSignupRegistrationStatus(): Promise<
  StaticResult<SignupRegistrationStatus>
> {
  const result = await dispatchQuery(AuthQueries.signupRegistrationStatus, {});
  if (result.kind === "failure") return result;
  if (!isRecord(result.data) || typeof result.data["enabled"] !== "boolean") {
    return staticFailure(UNEXPECTED_RESPONSE_REASON);
  }
  return staticSuccess({ enabled: result.data["enabled"] });
}

async function postAuthRoute(
  path: string,
  payload: Record<string, unknown>,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  const result = await postJson(path, payload, options);
  return result.kind === "success" ? staticSuccess(undefined) : result;
}

/** Answers success whether or not the address has an account, so it cannot be used to probe. */
export function requestPasswordReset(
  email: string,
  options: StaticRequestOptions & { readonly returnTo?: string } = {},
): Promise<StaticResult<undefined>> {
  const { returnTo, ...requestOptions } = options;
  return postAuthRoute(
    "/api/auth/request-password-reset",
    { email, ...(isSafeReturnPath(returnTo) && { returnTo }) },
    requestOptions,
  );
}

export function resetPassword(
  token: string,
  newPassword: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  return postAuthRoute("/api/auth/reset-password", { token, newPassword }, options);
}

export function verifyEmail(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  return postAuthRoute("/api/auth/verify-email", { token }, options);
}

export type InviteInfo = { readonly email: string; readonly hasAccount: boolean };

/** Reads the pending invitation without consuming the token. */
export async function fetchInviteInfo(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<InviteInfo>> {
  const result = await postJson("/api/auth/invite-info", { token }, options);
  if (result.kind === "failure") return result;
  const { email, hasAccount } = result.data;
  if (typeof email !== "string" || typeof hasAccount !== "boolean") {
    return staticFailure(UNEXPECTED_RESPONSE_REASON);
  }
  return staticSuccess({ email, hasAccount });
}

export type InviteAccepted =
  | {
      readonly status: "accepted";
      readonly tenantId: string;
      readonly roles: readonly string[];
      readonly landingPath?: string;
    }
  // The invitation is used up but no session was minted (MFA gate): send the user to login.
  | { readonly status: "mfa-pending" };

function grantedRoles(body: Record<string, unknown>): readonly string[] {
  const user = body["user"];
  const sessionRoles = isRecord(user) ? user["roles"] : undefined;
  if (Array.isArray(sessionRoles)) {
    return sessionRoles.filter((role): role is string => typeof role === "string");
  }
  return typeof body["role"] === "string" ? [body["role"]] : [];
}

async function postInviteAccept(
  path: string,
  payload: Record<string, unknown>,
  options?: StaticRequestOptions,
): Promise<StaticResult<InviteAccepted>> {
  const result = await postJson(path, payload, options);
  if (result.kind === "failure") return result;
  const body = result.data;
  const tenantId = body["tenantId"];
  if (typeof tenantId !== "string") return staticSuccess({ status: "mfa-pending" });
  const landingPath = body["landingPath"];
  return staticSuccess({
    status: "accepted",
    tenantId,
    roles: grantedRoles(body),
    ...(isSafeReturnPath(landingPath) && { landingPath }),
  });
}

/** Visitor is signed in on this origin: attaches the invitation to that session. */
export function acceptInviteSignedIn(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<InviteAccepted>> {
  return postInviteAccept("/api/auth/invite-accept", { token }, options);
}

/** Invited address already has an account: signs in and accepts. */
export function acceptInviteWithLogin(
  token: string,
  email: string,
  password: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<InviteAccepted>> {
  return postInviteAccept(
    "/api/auth/invite-accept-with-login",
    { token, email, password },
    options,
  );
}

/** Invited address has no account yet: creates it with `password` and accepts. */
export function acceptInviteWithNewAccount(
  token: string,
  password: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<InviteAccepted>> {
  return postInviteAccept("/api/auth/invite-signup-complete", { token, password }, options);
}

/** Answers success whether or not the address exists or is locked, so it cannot be used to probe. */
export function requestAccountUnlock(
  email: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  return postAuthRoute("/api/auth/request-account-unlock", { email }, options);
}

/** The mail link carries the token in the query (`?token=`). Confirming an unlocked account is a no-op. */
export function confirmAccountUnlock(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  return postAuthRoute("/api/auth/confirm-account-unlock", { token }, options);
}

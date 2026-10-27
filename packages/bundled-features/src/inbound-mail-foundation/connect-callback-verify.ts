import type { SignatureExtraRouteVerifyRequest } from "@cosmicdrift/kumiko-framework/api";
import { ExtraRouteRejection } from "@cosmicdrift/kumiko-framework/api";
import type { Context } from "hono";
import { errorJson } from "./connect-route-responses.ts";
import { normalizeMailAddress } from "./handlers/account-address.ts";
import type { OAuthCodeExchange } from "./inbound-oauth-flow.ts";
import { type OAuthStatePayload, verifyOAuthState } from "./oauth-state.ts";

export type VerifiedCallback = { readonly code: string; readonly state: OAuthStatePayload };

export function verifyCallbackRequest(
  request: SignatureExtraRouteVerifyRequest,
  stateSecret: string,
): VerifiedCallback {
  const code = request.query["code"] ?? "";
  const rawState = request.query["state"] ?? "";
  if (!code || !rawState) {
    throw new ExtraRouteRejection(
      400,
      { error: { code: "invalid_callback", message: "missing code or state" } },
      "inbound-mail oauth callback missing code or state",
    );
  }
  const verified = verifyOAuthState(rawState, stateSecret);
  if (!verified.ok) {
    throw new ExtraRouteRejection(
      400,
      { error: { code: "invalid_state", message: `state rejected: ${verified.reason}` } },
      `inbound-mail oauth callback state rejected: ${verified.reason}`,
    );
  }
  return { code, state: verified.payload };
}

// The refresh token the account needs, or the response that refuses the exchange result.
export function refreshTokenOrRefusal(
  c: Context,
  state: OAuthStatePayload,
  tokens: OAuthCodeExchange,
): string | Response {
  // Personal only: a shared mailbox is often an M365 shared mailbox the admin opens with their own
  // login (delegated access). A token without access to it shows up as auth_error on the first sync.
  if (
    state.ownerUserId &&
    normalizeMailAddress(tokens.accountAddress) !== normalizeMailAddress(state.mailbox)
  ) {
    return errorJson(
      c,
      403,
      "mailbox_address_mismatch",
      `the account you signed in with is not ${state.mailbox}; sign in with that mailbox's account`,
    );
  }
  // No refresh token, no server-side sync. Consent must request offline_access (or
  // access_type=offline); the provider's oauth block owns the scopes.
  if (!tokens.refreshToken) {
    return errorJson(
      c,
      502,
      "no_refresh_token",
      `provider "${state.providerKey}" returned no refresh token — check the offline-access scope in the provider's oauth.scopes`,
    );
  }
  return tokens.refreshToken;
}

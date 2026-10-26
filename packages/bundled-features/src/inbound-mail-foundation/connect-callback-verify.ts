import type { SignatureExtraRouteVerifyRequest } from "@cosmicdrift/kumiko-framework/api";
import { ExtraRouteRejection } from "@cosmicdrift/kumiko-framework/api";
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

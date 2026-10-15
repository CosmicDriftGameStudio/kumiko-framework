import { AUTH_RESET_DEFAULT_TTL_MINUTES, AuthErrors } from "../constants.js";
import { AuthMailNotificationTypes } from "../mail-notifications.js";
import { signResetToken } from "../reset-token.js";
import {
  createTokenRequestHandler,
  type TokenRequestData,
  type TokenRequestOptions,
} from "./token-request-handler.js";

export type RequestPasswordResetOptions = TokenRequestOptions;

// Public shape re-exported for callers that build custom routes on top of
// the dispatcher (bypassing the framework's auth-routes).
export type RequestResetData = TokenRequestData<"reset-requested">;

// @wrapper-known semantic-alias
export function createRequestPasswordResetHandler(opts: RequestPasswordResetOptions) {
  return createTokenRequestHandler(
    {
      handlerName: "request-password-reset",
      successKind: "reset-requested",
      description:
        "Starts the emailed password-reset flow for an address by minting a signed, time-limited reset token and mailing the reset link, for any existing non-deleted account regardless of its verification state; the answer is identical for unknown addresses, so it never reveals whether an account exists.",
      defaultTtlMinutes: AUTH_RESET_DEFAULT_TTL_MINUTES,
      sign: signResetToken,
      notConfiguredError: AuthErrors.resetNotConfigured,
      notConfiguredI18nKey: "auth.errors.resetNotConfigured",
      // Password-reset has no extra skip condition — every existing,
      // non-deleted user can initiate a reset regardless of verification
      // state. The sessions feature handles the post-change revocation.
      extraSilentSkip: () => false,
      notificationType: AuthMailNotificationTypes.passwordReset,
    },
    opts,
  );
}

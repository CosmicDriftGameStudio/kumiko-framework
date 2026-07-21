import { AUTH_UNLOCK_DEFAULT_TTL_MINUTES, AuthErrors } from "../constants";
import { renderUnlockAccountEmail } from "../email-templates";
import { signUnlockToken } from "../unlock-token";
import {
  createTokenRequestHandler,
  type TokenRequestData,
  type TokenRequestOptions,
} from "./token-request-handler";

const UNLOCK_NOTIFICATION_TYPE = "auth-email-password:account-unlock";

export type RequestAccountUnlockOptions = TokenRequestOptions;

// Public shape re-exported for callers that build custom routes on top of
// the dispatcher (bypassing the framework's auth-routes).
export type RequestUnlockData = TokenRequestData<"unlock-requested">;

// @wrapper-known semantic-alias
export function createRequestAccountUnlockHandler(opts: RequestAccountUnlockOptions) {
  return createTokenRequestHandler(
    {
      handlerName: "request-account-unlock",
      successKind: "unlock-requested",
      defaultTtlMinutes: AUTH_UNLOCK_DEFAULT_TTL_MINUTES,
      sign: signUnlockToken,
      notConfiguredError: AuthErrors.unlockNotConfigured,
      notConfiguredI18nKey: "auth.errors.unlockNotConfigured",
      // No extra skip condition — any existing, non-deleted user can
      // request an unlock link regardless of whether they're actually
      // locked right now. Confirming just clears the (possibly already
      // empty) lockout state — harmless no-op if they weren't locked.
      extraSilentSkip: () => false,
      notificationType: UNLOCK_NOTIFICATION_TYPE,
      renderContent: renderUnlockAccountEmail,
    },
    opts,
  );
}

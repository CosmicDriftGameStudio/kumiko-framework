import { access } from "@cosmicdrift/kumiko-framework/engine";
import { AuthMailNotificationTypes } from "../mail-notifications.ts";
import { signResetToken } from "../reset-token.ts";
import { AUTH_INITIAL_PASSWORD_DEFAULT_TTL_MINUTES, AuthErrors } from "../web/constants.ts";
import {
  createTokenRequestHandler,
  type TokenRequestData,
  type TokenRequestOptions,
} from "./token-request-handler.ts";

export type RequestInitialPasswordData = TokenRequestData<"initial-password-requested">;

// Same signed token as the reset flow, so the existing reset page and reset-password handler
// accept it; only the lifetime, the mail and the caller differ.
export function createRequestInitialPasswordHandler(opts: TokenRequestOptions) {
  return createTokenRequestHandler(
    {
      handlerName: "request-initial-password",
      successKind: "initial-password-requested",
      description:
        "System-only: mints a long-lived signed token that lets the owner of an account created by a boot seed set a first password, and mails the link; never callable by a session or an anonymous caller.",
      defaultTtlMinutes: AUTH_INITIAL_PASSWORD_DEFAULT_TTL_MINUTES,
      sign: signResetToken,
      notConfiguredError: AuthErrors.resetNotConfigured,
      notConfiguredI18nKey: "auth.errors.resetNotConfigured",
      extraSilentSkip: () => false,
      notificationType: AuthMailNotificationTypes.initialPassword,
      forwardsReturnTo: false,
      access: { roles: access.system },
    },
    // tokenTtlMinutes is the reset flow's setting and must not shorten this one.
    {
      hmacSecret: opts.hmacSecret,
      appUrl: opts.appUrl,
      ...(opts.appName !== undefined && { appName: opts.appName }),
      ...(opts.locale !== undefined && { locale: opts.locale }),
    },
  );
}

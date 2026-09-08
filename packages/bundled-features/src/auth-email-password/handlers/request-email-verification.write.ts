import { AUTH_VERIFY_DEFAULT_TTL_MINUTES, AuthErrors } from "../constants";
import { renderVerifyEmail } from "../email-templates";
import { signVerificationToken } from "../verification-token";
import {
  createTokenRequestHandler,
  type TokenRequestData,
  type TokenRequestOptions,
} from "./token-request-handler";

const VERIFY_NOTIFICATION_TYPE = "auth-email-password:email-verification";

export type RequestEmailVerificationOptions = TokenRequestOptions;

export type RequestVerificationData = TokenRequestData<"verification-requested">;

// @wrapper-known semantic-alias
export function createRequestEmailVerificationHandler(opts: RequestEmailVerificationOptions) {
  return createTokenRequestHandler(
    {
      handlerName: "request-email-verification",
      successKind: "verification-requested",
      description:
        "Mails an address a signed, time-limited link to confirm it owns the mailbox; an already-verified address is skipped silently, and the answer looks the same for unknown addresses either way.",
      defaultTtlMinutes: AUTH_VERIFY_DEFAULT_TTL_MINUTES,
      sign: signVerificationToken,
      notConfiguredError: AuthErrors.verificationNotConfigured,
      notConfiguredI18nKey: "auth.errors.verificationNotConfigured",
      // Silent no-op for already-verified users. Flipped-together with
      // unknown/deleted to keep the enumeration surface symmetric — the
      // caller sees the same 200 regardless of whether a token was minted.
      extraSilentSkip: (user) => user.emailVerified === true,
      notificationType: VERIFY_NOTIFICATION_TYPE,
      renderContent: renderVerifyEmail,
    },
    opts,
  );
}

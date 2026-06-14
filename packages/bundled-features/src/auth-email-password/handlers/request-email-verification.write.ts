import { AUTH_VERIFY_DEFAULT_TTL_MINUTES, AuthErrors } from "../constants";
import { signVerificationToken } from "../verification-token";
import {
  createTokenRequestHandler,
  type TokenRequestData,
  type TokenRequestOptions,
} from "./token-request-handler";

export type RequestEmailVerificationOptions = TokenRequestOptions;

export type RequestVerificationData = TokenRequestData<"verification-requested">;

// @wrapper-known semantic-alias
export function createRequestEmailVerificationHandler(opts: RequestEmailVerificationOptions) {
  return createTokenRequestHandler(
    {
      handlerName: "request-email-verification",
      successKind: "verification-requested",
      defaultTtlMinutes: AUTH_VERIFY_DEFAULT_TTL_MINUTES,
      sign: signVerificationToken,
      notConfiguredError: AuthErrors.verificationNotConfigured,
      notConfiguredI18nKey: "auth.errors.verificationNotConfigured",
      // Silent no-op for already-verified users. Flipped-together with
      // unknown/deleted to keep the enumeration surface symmetric — the
      // caller sees the same 200 regardless of whether a token was minted.
      extraSilentSkip: (user) => user.emailVerified === true,
    },
    opts,
  );
}

import type { InboundMailContext, MailAccountRecord } from "./types.ts";

export type OAuthTokenSet = {
  readonly accessToken: string;
  /** ISO-Instant. TTL typisch ~1h ⇒ Foundation refresht before-poll. */
  readonly expiresAt: string;
  readonly refreshToken?: string;
  readonly scopesGranted: readonly string[];
};

export type OAuthCodeExchange = OAuthTokenSet & {
  /** Mailbox address of the account that signed in, from a token claim or the provider's profile
   *  call. The callback refuses a mailbox whose address differs, so nobody claims someone else's. */
  readonly accountAddress: string;
};

/**
 * OAuth portion of the contract — OAuth providers only; imap in password
 * mode omits `oauth`. The Foundation provides the routes
 * (`/inbound-mail/connect`, `/inbound-mail/oauth/callback`) generically;
 * providers MUST NOT register their own routes.
 */
export type InboundOAuthFlow = {
  /** Scopes: request receive AND send in a SINGLE consent; re-consent is costly. */
  readonly scopes: {
    readonly receive: readonly string[];
    readonly send?: readonly string[];
  };
  readonly buildAuthorizeUrl: (
    ctx: InboundMailContext,
    p: { readonly state: string; readonly redirectUri: string },
  ) => Promise<string>;
  readonly exchangeCode: (
    ctx: InboundMailContext,
    p: { readonly code: string; readonly redirectUri: string },
  ) => Promise<OAuthCodeExchange>;
  readonly refreshAccessToken: (
    ctx: InboundMailContext,
    account: MailAccountRecord,
    refreshToken: string,
    /** The foundation aborts `signal` after a hard timeout while holding a
     *  per-account lock (a pool connection is pinned meanwhile). Providers
     *  MUST pass it to their token-endpoint fetch; the foundation awaits the
     *  provider's result and never drops a late one, because that could lose
     *  a rotated refresh token. */
    opts?: { readonly signal?: AbortSignal },
  ) => Promise<OAuthTokenSet>;
};

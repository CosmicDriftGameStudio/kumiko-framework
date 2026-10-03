---
"@cosmicdrift/kumiko-bundled-features": patch
---

Inbound mail OAuth accounts now refresh their access token. The sync supervisor mints a valid access token from the stored refresh token before each poll or watch start, caches it until shortly before expiry, shares one refresh between concurrent callers, and serializes refreshes and refresh-token writes per account with an advisory lock. A rotated refresh token is stored. An `invalid_grant` refresh failure (`InboundAuthError`) puts the account into `auth_error`. Provider authors receive the token declaratively as `opts.accessToken` in `fetch` (and as the optional fourth argument of `watch`). Supervisor logs and the OAuth callback's `502 token_exchange_failed` body no longer include provider error messages.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Inbound mail OAuth accounts refresh their access token
detail: |
  `createInboundMailSupervisor` obtains a valid access token via the new `createOAuthAccessTokenManager` before `plugin.fetch`/`plugin.watch` for accounts whose provider declares `oauth` and whose authMethod is `oauth`/`xoauth2`, and passes it as `opts.accessToken` (`fetch`) or `{ accessToken }` (`watch`, 4th argument). `refreshAccessToken` receives an optional 4th argument `{ signal }` (aborted after 30 s); providers must pass it to their token-endpoint fetch, since the foundation awaits the provider and never drops a late result. The foundation has no single construction point for routes and supervisor, so apps that want connect to prime the cache and write under the refresh lock create one manager with `createOAuthAccessTokenManager({ db, secrets })` and pass it to both `createInboundMailSupervisor({ oauthTokens })` and `createInboundMailConnectRoutes({ oauthTokens })`; without it the supervisor builds its own manager and the callback writes the secret without the lock. `InboundAuthError` from `refreshAccessToken` moves the account to `auth_error`; the generic sync-error log and the `token_exchange_failed` response body no longer contain provider error messages.
-->

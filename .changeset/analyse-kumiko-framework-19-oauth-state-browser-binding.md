---
"@cosmicdrift/kumiko-bundled-features": minor
---

The inbound-mail OAuth callback accepts a state only in the browser that started the connect flow.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: OAuth connect state is bound to the starting browser
detail: The signed state bound tenant, owner and mailbox, but a state link could be completed in any browser. An attacker could start a connect flow and let a victim sign in, which put the victim's mailbox into the attacker's account. The connect route now sets an HttpOnly, SameSite=Lax cookie scoped to the callback path, and the state carries its SHA-256 digest. Before exchanging the code, the callback answers 403 `state_browser_mismatch` when the cookie is missing or belongs to another flow. `OAuthStatePayload` replaces `nonce` with `browserBinding`, and `signOAuthState` takes the full payload. The nonce never gave replay protection; the provider's authorization code is single-use. New exports: `OAUTH_BROWSER_BINDING_COOKIE` and `oauthBrowserBinding`.
migration: Serve the connect route and the callback on the same host, because the cookie is host-scoped. Code that calls `signOAuthState` directly passes `browserBinding: oauthBrowserBinding(<cookie value>)`.
affects: inbound-mail-foundation, signOAuthState, OAuthStatePayload
-->

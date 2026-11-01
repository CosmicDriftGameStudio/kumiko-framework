---
"@cosmicdrift/kumiko-bundled-features": minor
---

DOM-free clients for public pages on static sites: waitlist sign-up, keep-account link, password reset, e-mail verification, invite acceptance and the signup registration status.

<!-- kumiko-changes
feature: waitlist
type: improvement
title: waitlist/static-submit, a DOM-free waitlist sign-up client
detail: `@cosmicdrift/kumiko-bundled-features/waitlist/static-submit` exports `submitToWaitlist(submission)` for plain Astro scripts: fetch plus pure logic, no renderer, React or `window` at import time. It posts `waitlist:write:submit` same-origin with name, email, optional company, portfolio and message, the page locale (also sent as `X-Locale`) and the honeypot field `website`. Blank optional fields are dropped. The result is a discriminated union `{ kind: "success"; data } | { kind: "failure"; reason; message?; retryAfterSeconds? }`; a network error is the reason `network`, a 429 is `rate_limited`.
-->

<!-- kumiko-changes
feature: tenant-inactivity
type: improvement
title: tenant-inactivity/static-keep-account, a DOM-free keep-account client
detail: `@cosmicdrift/kumiko-bundled-features/tenant-inactivity/static-keep-account` exports `keepAccount(token)`, which posts `tenant-inactivity:write:keep-account`, and `takeKeepAccountToken()`, which reads the `#token=` fragment of the mail link and removes it from the address bar. Results use the same `kind: "success" | "failure"` union as the other static clients; an expired or replaced link is a failure.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: auth-email-password/static-account, DOM-free account page clients
detail: `@cosmicdrift/kumiko-bundled-features/auth-email-password/static-account` exports `fetchSignupRegistrationStatus`, `requestPasswordReset`, `resetPassword`, `verifyEmail`, `requestAccountUnlock`, `confirmAccountUnlock`, `logout`, `isSignedOutFailure`, `fetchInviteInfo`, `acceptInviteSignedIn`, `acceptInviteWithLogin` and `acceptInviteWithNewAccount` for plain Astro scripts, plus `takeUrlToken("query" | "fragment")` to read a mail-link token and remove it from the address bar. Every call returns a `kind: "success" | "failure"` union with a `reason` and, for rate limits, `retryAfterSeconds`; a 401 without an error code reads as `unauthenticated`; none throws for an expected failure; a malformed CSRF cookie sends no CSRF header instead of failing the request. A `landingPath` from the server is passed on only when it is a safe same-origin path. The shared request core with the result types is exported as `auth-email-password/static-client`.
-->

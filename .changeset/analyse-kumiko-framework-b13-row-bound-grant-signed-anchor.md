---
"@cosmicdrift/kumiko-bundled-features": minor
---

Row-bound grants carry their anchor signed in the token, so the signature is checked before any row lookup or tenant switch.

<!-- kumiko-changes
feature: shared
type: breaking
title: Row-bound grants verify the signature before the row lookup
detail: `signRowBoundGrant` now puts the anchor next to the subject in the signed token body (`<subject>:<anchor>.<expiresAtMs>.<hmac>`), and the HMAC covers a purpose namespaced for row-bound grants, so neither a plain `signToken` token nor a grant in the previous format verifies as a grant. `redeemRowBoundGrant` checks signature and expiry first, calls `loadAnchor` only for a genuine token and then compares the row's current anchor with the signed one, so a forged token never reaches the database. The new `verifyRowBoundGrant({ token, purpose, secret, now })` runs the same check without database access and returns subject and anchor; it fails closed on an empty secret. The anonymous `open-by-link`, `sign-by-link` and `decline-by-link` handlers of `signature` verify the link before switching into the request's tenant. Subject and anchor are readable in the token and must not contain `:` or `.`; minting throws otherwise. `peekTokenSubject` (`shared/signed-token`) and `peekTenantScopedSubject` (`shared/tenant-scoped-subject`) are removed. Every grant minted before this version is invalid: deletion and deletion-cancel mails, keep-account mails, tenant-handover grants, signing links and app grants built on `signRowBoundGrant`.
migration: A wrapper that picks a tenant from a grant replaces `peekTokenSubject(token)` or `peekTenantScopedSubject(token)` with `verifyRowBoundGrant({ token, purpose, secret, now })` and parses `subject` of an ok result, for example with `parseTenantScopedSubject`. Links already sent stop working and have to be issued again.
-->

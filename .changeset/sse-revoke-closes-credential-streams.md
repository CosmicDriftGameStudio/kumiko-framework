---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Logout, tenant-switch and personal-access-token revoke now close the exact credential's open SSE stream instead of leaving it running until the JWT/token expires on its own. `sessionRevoker` (the raw callback behind logout/tenant-switch) and PAT revoke (`revoke.write.ts`, `revokeAllPatTokensForUser`) now append an access-invalidation event scoped to the revoked session id(s)/token id(s), and the access-invalidation consumer closes only the matching stream(s) instead of doing nothing at all.

<!-- kumiko-changes
feature: framework
type: breaking
title: Session and PAT revoke now close their own credential's open SSE stream, not just other reasons' userwide invalidations
migration: |
  An app-injected SseBroker implementation must update its subscribeAccessInvalidation/publishAccessInvalidation signatures: the third parameter of subscribeAccessInvalidation is now an AccessInvalidationCredential object (`{ sid?, patTokenId? }`) instead of a bare sid string, and the second parameter of publishAccessInvalidation is now an AccessInvalidationScope object (`{ kind: "user" } | { kind: "all-except-session"; keptSessionId } | { kind: "sessions"; sessionIds } | { kind: "pat-tokens"; tokenIds }`) instead of a bare keptSessionId string. Example: `subscribeAccessInvalidation(userId, cb, sid)` becomes `subscribeAccessInvalidation(userId, cb, { sid })`, and `publishAccessInvalidation(userId, keptSessionId)` becomes `publishAccessInvalidation(userId, { kind: "all-except-session", keptSessionId })`.
-->

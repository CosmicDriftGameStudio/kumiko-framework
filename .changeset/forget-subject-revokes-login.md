---
"@cosmicdrift/kumiko-bundled-features": patch
---

`forget-subject` (crypto-shredding) now closes the login door for user subjects, not just the DEK: after the key erase + blind-index sweep + search purge, it flips the user to `status = Deleted` via `updateUserLifecycle` (a real `user.updated` event, so a `read_users` projection rebuild can't resurrect the account) and revokes all existing PATs cross-tenant via `revokeAllPatTokensForUser`. Previously a forgotten user's status, sessions and PATs stayed live — sessions happen to be covered by the status flip (session-callbacks re-validates `user.status` per request and rejects `Deleted`), but PATs never check user status (the resolver only looks at `revokedAt`/`expiresAt`), so a forgotten user's API credential kept working. Both steps are idempotent (set-once status, `revokedAt IS NULL` filter) and feature-guarded (`user` / `personal-access-tokens` must be mounted). Tenant subjects have no credentials and are unchanged.

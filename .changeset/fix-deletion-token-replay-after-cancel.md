---
"@cosmicdrift/kumiko-framework": patch
---

Close the deletion-token replay-after-cancel window (security, #354/1):

The anonymous email-deletion flow mints a stateless HMAC token (60-min TTL).
Previously a token stayed usable for its whole TTL even after the user cancelled
the deletion — a still-valid token (intercepted mail, stale browser tab) could
re-arm a second grace period.

Fix: a per-request `pendingDeletionRequestId` is now stored on the user row when
the request is minted (`request-deletion-by-email`) and nulled on
`cancel-deletion`. The same id is folded into the token's HMAC purpose
(`deletion-request:<id>`), so `confirm-deletion-by-token` recomputes the
signature against the row's CURRENT id: a token from a cancelled cycle (id
nulled) or a superseded one (newer id on the row) fails verification. The shared
`signToken`/`verifyToken` primitive is untouched — the binding rides the
existing purpose channel.

Schema: additive nullable column `read_users.pending_deletion_request_id` (text).
Consumer apps pick it up via a standard `ALTER TABLE … ADD COLUMN` on the next
`kumiko schema generate`; existing rows default to NULL ("no pending request").

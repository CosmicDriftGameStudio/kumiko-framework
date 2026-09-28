---
"@cosmicdrift/kumiko-bundled-features": minor
---

New POST /api/delivery/resubscribe route undoes an unsubscribe/opt-out

createUnsubscribeRoutes now also mounts POST /api/delivery/resubscribe (JSON {token} or form body only, never the query string, to stay safe against mail-client link prefetchers). It accepts the same signed tokens as the unsubscribe routes and re-enables the preference (signed-in user) or removes the address opt-out (no-account recipient). A resubscribed address opt-out is hard-deleted; a later re-opt-out for the same address/type/channel lands on a fresh event-stream generation instead of reviving the deleted one.

<!-- kumiko-changes
feature: delivery
type: improvement
title: New POST /api/delivery/resubscribe route undoes an unsubscribe/opt-out
migration: |
  No action needed: the route is additive and mounted automatically wherever createUnsubscribeRoutes({ secret }) already runs. Sign resubscribe links with the same signUnsubscribeToken/signAddressUnsubscribeToken used for unsubscribe links.
-->

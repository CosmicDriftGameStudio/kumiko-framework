---
"@cosmicdrift/kumiko-renderer": patch
---

Renderer race and input-loss fixes: stale async answers no longer overwrite newer state, running uploads are no longer lost silently, and dashboard reference columns link to their target.

<!-- kumiko-changes
feature: renderer
type: fix
title: stale async answers, silent input loss and missing dashboard links
detail: Notification inbox `loadMore`, presence heartbeats and related-list tab counts drop answers that a newer request or refetch superseded, and tab badges no longer show the previous record's numbers. A running upload in a draft wizard now asks before leaving. The SSE stall watchdog only arms on `open`, so a cold-start handshake is no longer aborted. A drawer redirect onto the open record of its own projectionDetail no longer navigates. Embedded-list stored references are looked up in one chunk within the list limit. Dashboard list reference cells link to the target detail screen. `StatusBadgeTone` now aliases `StatusBadgeOptionTone`; `isSessionEndedUploadError` is removed in favor of `isSessionEndedCause`.
-->

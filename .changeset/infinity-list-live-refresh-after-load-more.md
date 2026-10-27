---
"@cosmicdrift/kumiko-renderer": patch
---

A live refresh that a load-more supersedes is retried instead of lost.

<!-- kumiko-changes
feature: renderer
type: fix
title: A live refresh that a load-more supersedes is retried instead of lost
detail: When a live signal triggered a first-page refresh while the list loaded its next page, the refresh result was discarded and nothing re-ran it, so the change on page 1 stayed invisible until the next event. The discarded refresh now runs once more.
-->

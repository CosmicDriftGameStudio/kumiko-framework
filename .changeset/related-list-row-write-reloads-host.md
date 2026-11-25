---
"@cosmicdrift/kumiko-renderer": patch
---

A row action in a related list section now reloads the host record, so header actions follow the row change.

<!-- kumiko-changes
feature: renderer
type: fix
title: Related list row actions reload the host record
detail: A writeHandler row action in a relatedList section of a projectionDetail or edit screen now triggers the host's reload. Header actions and fields that depend on a value the row write changed on the host record no longer stay stale.
-->

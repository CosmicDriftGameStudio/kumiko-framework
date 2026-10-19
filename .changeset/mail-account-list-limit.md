---
"@cosmicdrift/kumiko-bundled-features": patch
---

The mailbox list query accepts the `limit` the list screen sends and applies it after the visibility filter in a stable order.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Mailbox list accepts the screen's limit
detail: account:list accepted an empty payload only, so the projectionList screen's limit was rejected. It now takes limit up to MAX_LIST_LIMIT and returns the visible mailboxes ordered by id.
-->

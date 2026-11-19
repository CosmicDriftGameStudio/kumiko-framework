---
"@cosmicdrift/kumiko-bundled-features": minor
---

`inbound-mail-foundation:query:message:list` pages newest first with a cursor and returns 50 messages by default.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: message:list pages with a cursor
detail: The query read every matching message of the tenant, filtered personal mail in memory and decrypted every row. It now orders by `receivedAt`, then `id`, newest first, takes `limit` (default 50, at most 200) and `cursor`, and returns `{ rows, nextCursor }`. `nextCursor` is null once the list is exhausted. Only the rows of the page are decrypted. A malformed cursor answers 400 `invalid_cursor`. `read_inbound_messages` gets indexes on `(tenantId, receivedAt)`, `(tenantId, accountId, receivedAt)` and `(tenantId, threadKey)`.
migration: Callers that need more than 50 messages either page with `cursor` until `nextCursor` is null or pass a `limit` of up to 200. Run `kumiko schema generate` for the new indexes.
affects: inbound-mail-foundation, InboundMailFoundation, message:list
-->

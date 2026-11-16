---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Server handlers and screens can read a whole entity list with one framework helper instead of their own page loop.

<!-- kumiko-changes
feature: framework
type: improvement
title: listAllPages reads every page of a list handler
detail: `listAllPages(fetchPage)` from `@cosmicdrift/kumiko-framework/engine` follows `nextCursor` with `limit: MAX_LIST_LIMIT` until the last page and throws `InternalError` when a handler repeats a cursor. `toListPage(value, source)` checks an untyped `{ rows, nextCursor }` response, for example from `ctx.dispatch.query` or `dispatcher.query`. The helpdesk feature reads requests and replies through it instead of its own offset loop.
-->

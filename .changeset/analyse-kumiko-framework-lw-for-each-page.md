---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Server code can walk a list page by page with one framework helper that has the same cursor and page-cap checks as listAllPages.

<!-- kumiko-changes
feature: framework
type: improvement
title: forEachPage visits every page of a list handler and can stop early
detail: `forEachPage(fetchPage, visit, { maxPages })` from `@cosmicdrift/kumiko-framework/engine` asks `fetchPage` for pages of `MAX_LIST_LIMIT` rows, follows `nextCursor` and hands each page's rows to `visit` before it fetches the next one, so nothing piles up in memory. When `visit` returns anything but `undefined`, paging stops and `forEachPage` resolves to that value, for example a `writeFailure`; otherwise it resolves to `undefined` after the last page. Like `listAllPages` it throws `InternalError` for a `maxPages` that is not a whole number of at least 1, for a list handler that repeats a cursor, and when the list still has a cursor after `maxPages` pages (default `LIST_ALL_PAGES_DEFAULT_MAX_PAGES` = 50, so 10,000 rows); the pages up to the cap have been visited by then. `listAllPages` now runs on the same loop, and its cap message points to `forEachPage`. In bundled-features the signature sweep, the unfinished-signer erasure, `tag:delete` and `folder:delete` page through `forEachPage` instead of their own uncapped loops. A tenant with more than 10,000 signature requests in one status now gets an `InternalError` from those jobs after the first 10,000 are processed, and a `tag:delete` or `folder:delete` with more than 10,000 assignments fails with `InternalError` and rolls back instead of deleting them all in one transaction.
-->

---
"@cosmicdrift/kumiko-framework": minor
---

A query handler that returns a failure (`failNotFound`, `failUnprocessable`, ...) is reported like a thrown error.

<!-- kumiko-changes
feature: framework
type: breaking
title: Returned query failures are thrown
detail: When a query handler returns a failed `WriteResult`, the dispatcher throws it as a `KumikoError` with the failure's code, status, message and details. `/api/query` answers with that status and error body instead of `200` with `{ data: { isSuccess: false, ... } }`. `ctx.dispatch.query`, `queryAs`, `systemQuery` and the query deps of extra routes and `r.httpRoute` reject, and an extra route that does not catch it answers with the error's status. A query handler can keep `return failNotFound(...)`; callers no longer unwrap `isSuccess` from query results.
migration: Remove code that reads `isSuccess`, `data` or `error` from a query result and catch the thrown error where a caller needs to react to it. An app route that unwrapped a query result for HTTP can return the result directly.
affects: all
-->

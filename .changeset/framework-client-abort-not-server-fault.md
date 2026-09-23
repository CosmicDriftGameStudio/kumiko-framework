---
"@cosmicdrift/kumiko-framework": patch
---

A client that disconnects mid-request no longer produces `[api] handler failed` with `cause: "The connection was closed."`. That message is Bun's `Request.signal` abort reason, not a closed database connection.

- Queries: a failure caused by this request's own abort signal now answers `499` and logs `[api] request aborted by client` on warn instead of a 5xx server fault.
- Writes (`/api/write`, `/api/batch`, `command`): write dispatch no longer receives the request's abort signal, so a disconnect can't roll back a transaction halfway and leave a cached 500 under the request's idempotency key. `ctx.signal` is `undefined` inside write handlers and their hooks.

<!-- kumiko-changes
feature: framework
type: fix
title: Client disconnects answer 499 on queries and no longer abort writes
-->

---
"@cosmicdrift/kumiko-framework": patch
---

Read retry recognizes real closed pool connections instead of client aborts

The closed-connection read retry now checks driver error codes (postgres-js CONNECTION_CLOSED, Bun ERR_POSTGRES_CONNECTION_CLOSED, SQLSTATE 57P01) instead of an AbortError name and message. It retries up to pool size plus one attempt, never retries a genuine client abort, and never retries on a transaction or reserved handle. extractPgError/isUniqueViolation/constraintOf now also work against Bun.SQL errors.

<!-- kumiko-changes
feature: framework
type: fix
title: Read retry recognizes real closed pool connections instead of client aborts
-->

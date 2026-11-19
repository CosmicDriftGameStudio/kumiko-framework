---
"@cosmicdrift/kumiko-framework": patch
---

An `internal_error` answers with the generic message "internal error" outside development and test.

<!-- kumiko-changes
feature: framework
type: fix
title: Internal error texts stay in the server log
detail: `serializeError` dropped only the `details` of an `internal_error` in production and sent the developer text of `new InternalError({ message })` to the client, often with handler names and config keys. Outside NODE_ENV development and test the response now carries the message "internal error" and neither `details` nor `i18nParams`. The auth routes (login, MFA, signup, invite, token flows, tenant switch), which answered with the raw write error, follow the same rule through `toClientWriteErrorInfo`. The server log keeps the original message, and development and test still show the message and the cause.
-->

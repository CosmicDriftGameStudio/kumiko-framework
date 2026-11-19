---
"@cosmicdrift/kumiko-bundled-features": patch
---

The subscription webhook no longer returns internal error details to the caller.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Subscription webhook 500 answers without error details
detail: A failed `process-event` or `process-payment-event` dispatch answered 500 with the dispatcher error in `details`, including validation issues and internal messages. The response now carries only `code` and `message`; the error goes to the server log under `billing-foundation:webhook`.
-->

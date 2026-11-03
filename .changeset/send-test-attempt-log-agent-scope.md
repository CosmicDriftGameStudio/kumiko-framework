---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

The template test mail now works from an agent tool call. send-test no longer declares an `unsafeRaw` escapeHatch; delivery logs the attempt on its own connection through the new `_deliveryAttemptLogFactory`, which `createDeliveryTestContext` and the prod boot wire next to `_notifyFactory`.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Test mail attempt log works from agent tool calls
detail: send-test drops its unsafeRaw escapeHatch, which the agent tool-call scope refuses. The attempt row is written by delivery (createDeliveryAttemptLogFactory, bound per call as ctx.services._logOwnDeliveryAttempt) on the outside-transaction connection, so a failed test mail stays logged after the handler transaction rolls back. Apps that build their own extraContext without createDeliveryTestContext or the prod boot must set _deliveryAttemptLogFactory, otherwise send-test fails closed before sending.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

Delivery stores and returns only fixed error codes, never raw error messages. `delivery_attempts.error`, the `deliveryAttempt` event, `NotifyResult.deliveries[].error` and the job failure now hold one of `DELIVERY_FAILURE_CODES` (`timeout`, `network_error`, `redirect_blocked`, `host_not_allowed`, `missing_credentials`, `invalid_address`, `unexpected_response`, `render_failed`, `send_failed`, `channel_error`), one of `DELIVERY_SKIP_REASONS`, or `http_<status>`. A throwing channel ends as `send_failed` or `render_failed`; a failure around resolve or dispatch ends as `channel_error`. The full error goes to the log with URLs and email addresses redacted. `redactUrls` and `redactErrorText` are new next to `redactEmailAddresses`, which moved out of the step dispatcher.

`@cosmicdrift/kumiko-framework/engine` exports `DELIVERY_FAILURE_CODES`, `DELIVERY_SKIP_REASONS`, `isDeliveryErrorCode` and the types `DeliveryErrorCode`, `DeliveryFailureCode`, `DeliverySkipReason` and `ChatSendFailureCode`. `NotifyDelivery.error`, `ChannelResult.error` and `DeliveryLogEntry.error` are now `DeliveryErrorCode`. `delivery:query:log` returns `channel_error` for stored rows that still hold free text.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Delivery errors are fixed codes instead of raw messages
migration: |
  NotifyDelivery.error is now a DeliveryErrorCode. Code that matches on error text must match the code instead (for example send_failed). Custom channels must return a DeliveryErrorCode in ChannelResult.error. Existing attempt events keep their free text; reading them through delivery:query:log masks it as channel_error.
-->

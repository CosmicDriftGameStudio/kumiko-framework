---
"@cosmicdrift/kumiko-bundled-features": patch
---

A provider event for a tenant without subscription is retried only while it is young.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Webhook events without a subscription stop answering 503 after an hour
detail: An `updated`, `canceled` or invoice event that arrives before its subscription exists is redelivered (503) only while its provider event time is at most 60 minutes old. Older ones are ignored with 200 (`subscription_not_yet_created`), so a `created` that never comes (subscription from before the checkout ledger, foreign custom_data, deleted subscription) no longer drives the provider's endpoint into disabling. A provider that sends no event time (mollie) keeps retrying as before.
-->

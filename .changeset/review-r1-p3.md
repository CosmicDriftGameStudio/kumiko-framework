---
"@cosmicdrift/kumiko-bundled-features": patch
---

Inbound mail and billing review fixes: to/cc lists are cut to the event limit, forget-message refuses without file storage, a plan-switch consent survives interleaved state events, and a fresh Stripe subscription without a linked session is redelivered.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: to/cc lists fit the ciphertext limit, forget-message needs file storage
detail: normalizeRawInboundMessage drops addresses from the end of to/cc until the serialized list fits INBOUND_ADDRESS_LIST_JSON_MAX_CHARS, and ingestMessageSchema rejects longer lists, so a mail to a large distribution list no longer fails the event append. Entity and event limits derive from shared constants. forget-message fails before archiving when a stored original exists but no file storage is configured. The content-refetch scan marker belongs to one poller instead of the module.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: plan-switch consent survives interleaved state events, one stream load per webhook
detail: pendingSwitchConsentId no longer limits the consent search to events after the last state event, so a same-tier update between switch-plan and the tier change keeps the consent. process-event loads the subscription stream once under the lock for admission and append. Ignored-event reasons share one IgnoredEventReasons object and the provider id limit one constant.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: customer.subscription.created without a linked checkout session is redelivered while young
detail: An empty checkout session list for a created event younger than ten minutes answers 503 so Stripe redelivers, instead of dropping the subscription as not in the ledger.
-->

<!-- kumiko-changes
feature: subscription-paddle
type: fix
title: unreadable ledger backfill marker no longer causes endless 503
detail: shouldRedeliverLegacyCheckout answers 200 and logs when the marker dispatch fails, because custom_data.tenantBinding is client-settable.
-->

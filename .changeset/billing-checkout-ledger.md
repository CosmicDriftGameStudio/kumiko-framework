---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Billing webhooks are only accepted for checkouts the server opened itself.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Billing webhooks are accepted only for checkouts the server opened
detail: A tenant member could replay the tenant binding of their own checkout and open checkouts of their own at the provider, which skipped the consent step, the oneOffPriceIds allowlist, the role checks and billingLive. `createCheckoutSession` of a provider plugin now returns `{ url, providerCheckoutId }`, the new SystemAdmin handler `billing-foundation:write:record-checkout-opened` records that id in a checkout ledger on the tenant's subscription or payment stream, and `process-event` and `process-payment-event` ignore (HTTP 200 with `ignored: true`) any event whose checkout is not in the ledger or whose price does not match the ledgered price. A created subscription needs a ledgered checkout for its tier; later events of that subscription are admitted by the subscription itself. The consent of a plan switch comes from the newest unconsumed recorded checkout consent instead of a `consentId` in the provider payload, so `SubscriptionEvent.consentId` and the `consentId` in provider metadata are gone and `SubscriptionEvent` and `PaymentEvent` may carry `providerCheckoutId`. A non-created subscription event for a tenant without any subscription answers a retryable 503 (`subscription_event_redeliver`) instead of 200, so an `updated` that beats its `created` is redelivered by the provider; an event of another subscription than the held one stays a 200 ignore. `SubscriptionProviderPlugin` gains the optional `shouldRedeliverIgnoredEvent`, asked when an event is ignored as `checkout_not_in_ledger`; true makes the route answer 503.
migration: |
  Custom subscription provider plugins: return `{ url, providerCheckoutId }` from `createCheckoutSession`, put the id of the provider checkout (Stripe session, Mollie first payment, Paddle transaction) on `SubscriptionEvent.providerCheckoutId` and `PaymentEvent.providerCheckoutId` for the created and payment events, and stop reading or writing a `consentId` in provider metadata or webhook payloads. Checkouts opened before the upgrade have no ledger entry: Paddle ones are taken over by the new job (see subscription-paddle), Stripe and Mollie ones are ignored by the webhook, so let open sessions finish or expire before upgrading.
-->

<!-- kumiko-changes
feature: subscription-paddle
type: breaking
title: Paddle checkouts are bound by the checkout ledger, the tenant binding key is gone
detail: The HMAC `tenantBinding` in custom_data and the PADDLE_TENANT_BINDING_KEY / `tenant-binding-key` setting are removed; a webhook is accepted when its transaction id is in the checkout ledger. The new job `backfill-checkout-ledger` (cron every 5 minutes, no-op without an API key) lists open Paddle transactions created through the API, ledgers the ones that still carry a `tenantBinding`, keeps sweeping for one hour after its first completed sweep and then does nothing. The sweep also lists billed, paid and completed transactions of the last 7 days, and while the takeover window is open (no completed sweep yet, or one younger than an hour) a webhook of a legacy checkout (custom_data still has `tenantBinding`) that is not in the ledger yet answers 503, so Paddle redelivers it after the sweep ledgered the checkout.
migration: |
  Remove PADDLE_TENANT_BINDING_KEY from the environment and the `subscription-paddle:config:tenant-binding-key` value from the secrets; nothing reads them any more. Checkouts that customers opened before the upgrade are taken over by the `backfill-checkout-ledger` job within about five minutes, so no manual step is needed. The job needs a worker that runs the system-identity jobs.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: breaking
title: Stripe checkouts are matched by session id, consentId metadata is gone
detail: `createCheckoutSession` returns the Checkout Session id as `providerCheckoutId`, and `customer.subscription.created` looks up the session of the subscription (`checkout.sessions.list`) to carry that id; if the Stripe API call fails, the webhook replies 503 so Stripe retries; a successful empty list yields a created event without checkout id that is ignored as not in the ledger. Session metadata carries only the tenantId. The new option `clientConfig` passes Stripe SDK client settings, for tests against a local fixture API.
migration: |
  Open Checkout Sessions from before the upgrade are not in the ledger and their `customer.subscription.created` and payment events are ignored; let them expire or finish first. The API key of the Stripe plugin needs read access to Checkout Sessions.
-->

<!-- kumiko-changes
feature: subscription-mollie
type: breaking
title: Mollie first payments are matched by payment id, consentId metadata is gone
detail: `createCheckoutSession` returns the first payment's id as `providerCheckoutId`; the created event of the subscription made from that mandate payment carries it. Payment and subscription metadata no longer hold a consentId.
migration: |
  First payments created before the upgrade are not in the ledger and their webhook is ignored; let open mandate checkouts finish first.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

create-checkout-session and create-portal-session are now hardened: origin-checked redirects, known-price validation, plan-switch conflicts

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: create-checkout-session and create-portal-session are now hardened: origin-checked redirects, known-price validation, plan-switch conflicts
migration: |
  Mount the foundation via createBillingFoundationFeature({ baseUrl }) (a
  path prefix is fine, e.g. "https://app.example.com/tenant-x"). Without
  baseUrl, every create-checkout-session call now fails with an
  UnconfiguredError on the "baseUrl" key, including mode:"payment" checkouts.

  create-checkout-session: successUrl/cancelUrl must share baseUrl's origin,
  or the call fails with an UnprocessableError whose details.reason is
  "redirect_origin_not_allowed". For mode:"subscription" (the default when
  mode is omitted), priceId must be a price the resolved provider's
  priceToTier map actually knows about, and, if a catalog is configured,
  must map to one of catalog.plans, or the call fails with reason
  "unknown_price". A tenant with an existing non-terminal subscription can
  no longer open a second subscription checkout. A ConflictError with
  i18nKey "billing-foundation.errors.subscriptionExists" fires instead; call
  billing-foundation:write:switch-plan to change plans. mode:"payment"
  (one-off top-ups etc.) is exempt from both the price and the
  subscription-conflict check and keeps working on an active subscription
  unchanged.

  Provider plugins written before this release should add a priceToTier map
  on their SubscriptionProviderPlugin; without one, every mode:"subscription"
  checkout is rejected with reason "provider_has_no_price_catalog".

  Direct-priceId callers of create-checkout-session should migrate to a
  catalog plus billing-foundation:write:start-plan-checkout /
  billing-foundation:write:switch-plan (or the BillingPlansPanel widget),
  which pick the price server-side and never expose a raw priceId to the
  client.

  create-portal-session: when baseUrl is set, the payload's returnUrl must
  also share its origin, or the same redirect_origin_not_allowed error
  fires. Unchanged when baseUrl is not configured.

  create-checkout-session: an optional providerCustomerId is now only
  accepted if it belongs to the tenant's own subscription at the same
  provider, including a canceled one. Otherwise the call fails with an
  UnprocessableError whose details.reason is "foreign_provider_customer".
  This closes a gap where a TenantAdmin could pass another tenant's
  provider customer id and have the checkout attach to that customer's
  stored payment methods and invoices. Checked in both mode:"subscription"
  and mode:"payment".
-->

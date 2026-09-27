---
"@cosmicdrift/kumiko-bundled-features": minor
---

create-checkout-session's mode:"payment" now requires a declared one-off-price allowlist

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: create-checkout-session's mode:"payment" now requires a declared one-off-price allowlist
migration: |
  SubscriptionProviderPlugin gains an `oneOffPriceIds` field (a readonly
  string array, defaulting to empty). create-checkout-session's
  mode:"payment" branch now rejects any priceId that isn't in the
  resolved provider's `oneOffPriceIds` with an UnprocessableError whose
  details.reason is "unknown_price" (same shape as the existing
  subscription-mode price check) — previously any priceId was accepted,
  so a TenantAdmin could start a one-off checkout against an arbitrary
  Stripe price. mode:"payment" also now goes through the same
  isBillingEnabled gate as mode:"subscription", before the redirect-origin
  check, and fails with FeatureDisabledError when billing isn't enabled.

  Every provider mount that offers one-off purchases (credit packs,
  top-ups, ...) must list their priceIds explicitly. offlot-app's
  start-pack-checkout.write.ts mounts Stripe for credit-pack purchases via
  mode:"payment" and needs its pack priceIds added, e.g.:
  `createSubscriptionStripeFeature({ priceToTier, oneOffPriceIds: configuredPackPriceIds() })`
  (or the equivalent option on its provider plugin), or every pack
  checkout starts failing with "unknown_price" after this release.
  `oneOffPriceIds` is validated at mount time — an empty-string entry or a
  duplicate priceId now throws instead of silently widening/narrowing the
  allowlist.
-->

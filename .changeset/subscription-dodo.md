---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-locale-de": minor
---

Dodo Payments as a subscription provider, and billing-foundation offers several providers side by side.

<!-- kumiko-changes
feature: subscription-dodo
type: improvement
title: New subscription provider for Dodo Payments
detail: createSubscriptionDodoFeature() registers the "dodo" subscription provider (Merchant of Record). It verifies Standard Webhooks signatures, maps Dodo events to the foundation events, creates hosted checkouts and portal sessions, and switches plans in the app through previewPlanSwitch and applyPlanSwitch. Config keys are api-key, webhook-secret, billing-live and environment. Plan switches need a Product Collection in Dodo.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Several subscription providers in one catalog
detail: The billing-plans query returns providers (name, displayName, plans, note) when more than one provider is offered, and start-plan-checkout takes providerName. consumerProtection.providerTexts overrides checkoutNote and vatNote per provider, and the consent record carries providerName. switch-plan always uses the provider of the existing subscription.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: In-app plan switch with a preview and consent
detail: A provider plugin that implements previewPlanSwitch and applyPlanSwitch switches plans without a hosted portal. The new plan-switch-preview query returns the proration, the billing-plans result carries inAppPlanSwitch, and the panel shows PlanSwitchConfirmDialog with the withdrawal consent checkboxes. The confirmation mail is sent when the plan_changed webhook arrives with the consent id.
-->

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: A catalog with several providers no longer throws an ambiguous-provider error
detail: With more than one subscription provider mounted, billing-plans and start-plan-checkout used to throw. They now list the providers; start-plan-checkout answers with errors.providerRequired when several are offered and no providerName is given, and errors.providerNotOffered for an unknown one. Plugins have to set displayName.
migration: Set displayName on custom subscriptionProvider plugins. Callers that send start-plan-checkout with several providers mounted must pass providerName.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: improvement
title: Stripe plugin has a displayName
detail: The Stripe plugin sets displayName "Stripe", which the provider choice in the billing panel shows.
-->

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: billing boot option takes stripe and/or dodo
detail: billing.stripe is now optional and billing.dodo is new (priceToTier, oneOffPriceIds). At least one is required. resolveBillingOption returns features (an array) instead of feature, and one webhook route serves every provider on stripe.webhookPath or SUBSCRIPTION_WEBHOOK_PATH. DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_WEBHOOK_KEY are the env bridge.
migration: Callers of resolveBillingOption use billing.features instead of billing.feature.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German strings for the provider choice and the in-app plan switch
detail: Adds billing-foundation planSwitch.*, plans.providerChoice, plans.planSwitchRequested and the providerNotOffered and providerRequired errors.
-->

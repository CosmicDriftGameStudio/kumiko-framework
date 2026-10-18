---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Stacks name the runProdApp option they need, plus auth, SaaS and security stacks

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp names the stack and the boot option it is missing
detail: Features returned by the compose*Stack helpers carry bootRequires ({ stack, options }), a new optional FeatureDefinition field; BootOptionName and StackBootRequirement are exported from @cosmicdrift/kumiko-framework/engine. runProdApp checks them before it wires the boot options and fails with "[runProdApp] stacks in `features` need boot options that are not set:" followed by one line per gap, for example "composeSaasStack needs the boot option `billing`: set billing: { stripe: { priceToTier }, defaultTier }". composeMailStack and composeUserDataRightsStack need mail (or a mounted channel-email), composeFileStack without providers needs fileStorage (or a mounted file provider), composeGdprStack and composeSecurityStack need kmsMode (or kms / allowPlaintextPii), composeSecurityStack also fails with rateLimit: false, composeSaasStack with billing "stripe" needs billing (or a mounted subscription provider). composeFileStack takes providers as optional now. The renderer, pages, ops and identity stacks need no option. resolveBillingOption is exported from @cosmicdrift/kumiko-server-runtime/boot-options/billing for tests that mount the billing wiring on a test stack.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeAuthStack, composeSaasStack and composeSecurityStack
detail: composeAuthStack({ sessions?, mfa?, accountSecurity? }) mounts auth-foundation and sessions, with mfa also auth-mfa and account-security; the password login still comes from the auth option or composeFeatures. composeSaasStack({ billing: "stripe" | "mollie", tiers, caps?, waitlist?, billingFoundation? }) mounts billing-foundation and tier-engine, cap-counter plus cap-overview with caps, waitlist with waitlist. With "stripe" the runProdApp billing option mounts subscription-stripe and the tier-sync webhook route; with "mollie" the stack mounts subscription-mollie from the mollie options and the app adds the webhook route. composeSecurityStack({ includeSessions? }) mounts sessions, crypto-shredding, rate-limiting and audit. composeGdprStack({ selfService: { userDataRights? } }) adds sessions, user-data-rights and user-profile in the order dsgvoSelfServiceFeatures used. billing-foundation requires tenant-lifecycle and compliance-profiles, which composeGdprStack({ tenantLifecycle: true }) mounts. user-profile in selfService requires user-data-rights-defaults and auth-email-password; composeUserDataRightsStack mounts the defaults, and the login comes from the auth option. Recipe: samples/recipes/compose-stacks.
-->

<!-- kumiko-changes
feature: presets
type: improvement
title: securityBaselineFeatures and dsgvoSelfServiceFeatures are deprecated
detail: Both presets stay for one release. Replace securityBaselineFeatures({ includeSessions }) with composeSecurityStack({ includeSessions }) and dsgvoSelfServiceFeatures({ userDataRights }) with composeGdprStack({ selfService: { userDataRights } }), both from @cosmicdrift/kumiko-dev-server/compose-stacks. The stacks mount the same features in the same order.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp effectiveFeatures is deprecated
detail: effectiveFeatures stays for one release. createTierEngineFeature({ tierMap }), or composeSaasStack, builds the per-tenant feature resolver at boot, and the prod-only features come from the mail, fileStorage and billing options.
-->

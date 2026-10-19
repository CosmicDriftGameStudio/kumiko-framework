---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
---

runDevApp and runWorkerApp understand the declarative boot options of runProdApp, and the default mail resolver stops reaching users outside the notifying tenant.

`runDevApp` takes `mail`, `fileStorage`, `kmsMode`, `billing`, `seeds` (shortcuts plus free seeds that get the test stack), `demoMode`, `envSchema` and `featureToggles`; `runWorkerApp` takes `mail`, `fileStorage`, `kmsMode`, `billing`, `featureToggles` and `envSchema` and understands every `KUMIKO_DRY_RUN_ENV` mode. All of them resolve through the same functions as `runProdApp`. `featureToggles: true` mounts feature-toggles and layers the global operator switches over the tier resolver; `composeSaasStack({ featureToggles: true })` expects it. `runProdApp` seeds and `extraContext` factories receive `masterKeyProvider` and `configEncryption`; `appOverrides` overrides tenant-model, branding and seo defaults.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: effectiveFeatures is gone from runProdApp, runDevApp and runWorkerApp
detail: The effectiveFeatures option of the boot functions is removed. Global operator switches come from the featureToggles option, tier gating from the tier-engine feature, which the boot functions wire themselves.
migration: Replace a hand-built effectiveFeatures resolver with featureToggles true (global switches) and mount createTierEngineFeature for tier gating. A custom resolver that did neither has no replacement on the boot functions; wire it through createKumikoServer or setupTestStack in tests. The boot functions now abort when the option is still passed, because an ignored option would drop an operator kill-switch silently; the same goes for a feature-toggles feature in features without the featureToggles option, or with it set (the option mounts the feature).
-->

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: The default mail resolver only reaches members of the notifying tenant
detail: The default resolveEmail of the mail boot option returns an address for a notification from a tenant other than the system tenant only if the user is a member of that tenant or holds the SystemAdmin role in the stored user row. Everyone else resolves to null and the mail is skipped. The new option mail.recipientScope takes "membership" (default) or "any", which restores the old behaviour of reaching every user. EmailChannelOptions resolveEmail now receives the tenant database as TenantDb instead of unknown.
migration: Apps that notify users outside the notifying tenant on purpose, for example merchants reached from a SystemAdmin context, set mail recipientScope to "any" or keep their own resolveEmail. Apps whose notifications go to members of the active tenant need no change. Known consumers on the default: offlot-app (main.ts) reaches merchants and SystemAdmins across tenants and needs recipientScope any; publicstatus (main.ts), show-pony, solon (main.ts) and kumiko-studio (main.ts) take the default, which fits notifications to members of the active tenant. money-horse and phronexsis keep their own resolveEmail. Per-app resolvers that only copied the membership check can be deleted. A custom resolveEmail that cast ctx.db can drop the cast.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: resolveEmail receives a typed tenant database
detail: The context of EmailChannelOptions resolveEmail types db as TenantDb, so resolvers read tables without a cast.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runDevApp and runWorkerApp take the declarative boot options
detail: mail, fileStorage, kmsMode, billing, seeds, demoMode, envSchema and featureToggles work in runDevApp, and mail, fileStorage, kmsMode, billing, featureToggles and envSchema in runWorkerApp, through the same resolve functions as runProdApp. The worker honours KUMIKO_DRY_RUN_ENV with an env schema. A stack that sets runSingleInstance false only warns when no worker mounts the features.
migration: RunDevAppOptions.seeds is now `readonly SeedFn[] | RunDevAppSeedsConfig`. Code that spreads `seeds` from an object typed as RunDevAppOptions no longer type-checks; declare that object with `satisfies RunDevAppOptions` so the array type survives, or build the seed list separately. An app that lists createFeatureTogglesFeature() in the features passed to runDevApp or runProdApp removes it there and sets `featureToggles: true`.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: featureToggles, appOverrides and secrets in boot deps
detail: featureToggles true mounts feature-toggles and layers the global switches over the tier resolver in runProdApp, runDevApp and runWorkerApp. appOverrides sets tenant-model, branding and seo defaults. masterKeyProvider and configEncryption reach extraContext factories, system wiring and seed functions, so an app no longer resolves its KEK a second time.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Boot errors for removed and half-wired feature toggles
detail: runProdApp, runDevApp and runWorkerApp abort when the removed effectiveFeatures option is still passed, and when feature-toggles sits in features without the featureToggles option. runWorkerApp now enforces a stack that expects featureToggles, so a worker cannot keep running jobs and event handlers of features an operator switched off.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Named S3 provider names are validated at boot
detail: fileStorage.providers refuses the names s3-env, s3 and inmemory, which the bundled providers register, and a name listed twice. A tenant admin can still select any mounted provider through the file-foundation provider config, so name a provider only if every tenant may use its bucket.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Named S3 providers and a corrected SMTP_HOST description
detail: fileStorage.providers takes entries with name, envPrefix and lazy, each validated through createS3EnvSchema with its own prefix. The SMTP_HOST description in the env schema of mail smtp-env now says the variable is required.
-->

<!-- kumiko-changes
feature: file-provider-s3
type: improvement
title: Named S3 provider feature
detail: createFileProviderS3NamedEnvFeature mounts an additional S3 provider under its own name with an env prefix, next to the default one, so a second bucket needs no hand-written wiring.
-->

<!-- kumiko-changes
feature: auth-foundation
type: improvement
title: authEnvSchema for auth.admin and auth.mail
detail: authEnvSchema declares APP_BASE_URL, AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD with descriptions and the pulumi secret marker; an app spreads its shape into its env schema.
-->

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: DELETION_TOKEN_SECRET is part of the env schema
detail: The feature declares DELETION_TOKEN_SECRET through its env schema, so the dry run and the pulumi inventory list it. Unset, it is derived from JWT_SECRET as before.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeSaasStack with stripe warns instead of requiring billing
detail: A stripe stack without the billing option logs a boot warning instead of aborting, and composeSaasStack takes featureToggles to require that option.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: StackBootRequirement severity and the featureToggles option name
detail: StackBootRequirement takes severity "warn" for requirements that only log, and BootOptionName lists featureToggles.
-->

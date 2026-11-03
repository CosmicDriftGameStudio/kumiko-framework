---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-locale-it": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
---

Review round 3 for misc fixes: the S3 production endpoint rule follows the booted env instead of process.env, the S3 env reader uses the shared required-env helper, public handlers declare only the anonymous role, the embedded-list limit range reads grammatically in it, es and fr, and boot-rule tables share one test helper.

<!-- kumiko-changes
feature: file-provider-s3
type: breaking
title: S3 endpoint rule from the booted env
detail: The https-only rule for remote S3 endpoints in production is no longer a field refinement that read the global process.env. isAcceptableS3Endpoint(value, isProduction) is applied against the env being booted: the endpoint variables carry it as an env rule (parseEnv and the boot dry run check it with the booted env record), runProdApp's fileStorage resolution applies it, and parseS3EnvConfig and createS3ProviderFromEnv take an optional env record (default process.env) and refuse a remote http endpoint when it says NODE_ENV=production. s3EndpointSchema now only validates the URL shape. createS3ProviderFromEnv reports a missing variable through requiredEnvFor (message "[S3 file provider] required env var X is missing or empty" instead of "missing_env: ...").
migration: Tests that matched the old "missing_env:" message match the requiredEnvFor message; code that parsed s3EndpointSchema alone to enforce the production https rule uses isAcceptableS3Endpoint(value, isProduction) or the env rule through parseEnv.
-->

<!-- kumiko-changes
feature: helpdesk
type: fix
title: Public handlers declare only the anonymous role
detail: Handlers declaring access.anySignedIn next to the anonymous role list only anonymous in roles (the dropped signed-in roles never had an effect); the SUBMIT_ROLES constant of helpdesk is removed.
-->

<!-- kumiko-changes
feature: waitlist
type: fix
title: Public handlers declare only the anonymous role
detail: Handlers declaring access.anySignedIn next to the anonymous role list only anonymous in roles (the dropped signed-in roles never had an effect); the SUBMIT_ROLES constant of waitlist is removed.
-->

<!-- kumiko-changes
feature: locale-it
type: fix
title: Embedded-list limit range wording
detail: The embedded-list limit-range text reads "Limite da {min} a {max}".
-->

<!-- kumiko-changes
feature: locale-es
type: fix
title: Embedded-list limit range wording
detail: The embedded-list limit-range text reads "Límite de {min} a {max}".
-->

<!-- kumiko-changes
feature: locale-fr
type: fix
title: Embedded-list limit range wording
detail: The embedded-list limit-range text reads "Limite de {min} à {max}".
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Boot-rule table test helper, env field rules
detail: @cosmicdrift/kumiko-framework/internal/testing exports bootRuleTableViolations for boot rule table tests (it returns the violations). An env field can carry a rule through .meta({ kumiko: { envRule } }) that sees the whole env being booted; parseEnv and the boot dry run apply it.
-->

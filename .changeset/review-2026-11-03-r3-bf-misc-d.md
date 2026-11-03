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
feature: bundled-features
type: fix
title: S3 endpoint rule from the booted env, public handler roles, locale wording
detail: The https-only rule for remote S3 endpoints in production is no longer a field refinement that read the global process.env; isAcceptableS3Endpoint(value, isProduction) is applied by runProdApp's fileStorage resolution against the booted env source, so an injected envSource with NODE_ENV=production is checked even when the process itself is not production, and s3EndpointSchema now only validates the URL shape. createS3ProviderFromEnv reports a missing variable through requiredEnvFor (message "[S3 file provider] required env var X is missing or empty" instead of "missing_env: ..."). Handlers declaring access.anySignedIn next to the anonymous role list only anonymous in roles (the dropped signed-in roles never had an effect); the SUBMIT_ROLES constants of helpdesk and waitlist are removed. The embedded-list limit-range text reads "Limite da {min} a {max}" (it), "Límite de {min} a {max}" (es) and "Limite de {min} à {max}" (fr). @cosmicdrift/kumiko-framework/internal/testing exports expectWellFormedBootRuleTable for boot rule table tests.
-->

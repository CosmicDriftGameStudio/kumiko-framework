---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": minor
---

envSchema required, boot dry run checks the env without values

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: runProdApp requires envSchema
detail: envSchema on runProdApp is no longer optional. Without it the boot throws a KumikoBootError that points to composeEnvSchema. An app without its own variables passes composeEnvSchema({ core: frameworkCoreEnvSchema, features }).
migration: Pass envSchema: composeEnvSchema({ core: frameworkCoreEnvSchema, features }) to runProdApp, with composeEnvSchema from @cosmicdrift/kumiko-framework/env and frameworkCoreEnvSchema from @cosmicdrift/kumiko-dev-server. App-level variables go into extend. Delete hand-written env checks that ran before runProdApp; the schema covers them.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: KUMIKO_DRY_RUN_ENV=boot prints an env table and exits 0 on missing values
detail: The boot dry run lists every variable of the composed schema with its feature, whether it is required, and whether it is set, missing or invalid. Values are never printed. An invalid value exits 1. A missing required value exits 0 and says the feature wiring was not validated; with every variable present the dry run validates the wiring as before. NODE_ENV=production does not change this. The MFA secret binding and other env reads run after this exit, so an empty env no longer crashes the dry run.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: inspectEnv, renderEnvInspection and the dry-run mode parser
detail: inspectEnv(schema, env, { sources }) checks each field on its own and returns its status (set, unset, missing, invalid) without the value; renderEnvInspection renders those rows as the boot table. parseDryRunEnvMode reads KUMIKO_DRY_RUN_ENV (1, true, human, json, pulumi, k8s, boot) and isDryRunEnvActive tells module-level code whether a dry run is running. DRY_RUN_ENV_VAR names the variable.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: createEnvMasterKeyProvider defers the keyring check in a dry run
detail: While KUMIKO_DRY_RUN_ENV is set, createEnvMasterKeyProvider no longer throws at construction on a missing or malformed keyring; the first key operation throws instead. Apps that build the provider at module load can run the boot dry run on an empty env. Outside a dry run the check still runs at construction, and the boot probe for encrypted entity fields forces it in both cases.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: runDevApp binds the MFA token secrets
detail: When auth-mfa is mounted and JWT_SECRET is set, runDevApp binds the MFA token secrets the same way runProdApp does.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: setupTestStack binds the MFA token secrets
detail: setupTestStack binds the auth-mfa token secrets from the stack's JWT secret, independent of the host env, so tests that mount auth-mfa without explicit secrets keep working.
-->

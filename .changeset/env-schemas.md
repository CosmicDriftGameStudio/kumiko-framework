---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Add Zod-based env-schema declarations and boot-time validation (Sprint 9.1).

**New API:**

- `r.envSchema(z.object({...}))` — declare per-feature env-vars at registration time.
- `@cosmicdrift/kumiko-framework/env`: `composeEnvSchema({features, extend, optionalFeatures})` merges feature schemas into one app-wide schema, returning `{schema, sources}`. `parseEnv(schema, env, {sources, pulumiPrefix})` validates `process.env` and throws `KumikoBootError` listing ALL problems at once (aggregated, not first-fail).
- `@cosmicdrift/kumiko-framework/env/dry-run`: `renderDryRun(composed, mode, opts)` for `human|json|pulumi|k8s` introspection of the required env-vars without booting.
- `runProdApp({envSchema, pulumiPrefix, bootErrorReporter, envSource})` runs schema validation before any DB/Redis connection. `KUMIKO_DRY_RUN_ENV=1|human|json|pulumi|k8s` prints the inventory and exits.
- Per-var metadata via Zod's `.meta({ kumiko: { pulumi: { name, generator, secret } } })` for deploy-time tooling overrides.

**Backward-compat:** Apps without `envSchema` keep working — existing `requireEnv("DATABASE_URL")` calls in `runProdApp` are untouched. Sprint-9.2-9.5 migrates framework + bundled-features + apps to schema-only env handling.

**Why:** 2026-05-21 Studio deploy stacked 7 hacks chasing missing env-vars (10+ pipeline-fail iterations, ended in rollback). Schema-first boot validation surfaces ALL misconfigs upfront with `pulumi config set …` suggestions, replacing the discover-by-failing loop with a single dry-run + secrets-bootstrap pass.

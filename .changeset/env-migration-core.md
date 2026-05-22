---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Add framework-core env-schema (Sprint 9.2, Migration Phase 1).

**New API:**

- `frameworkCoreEnvSchema` exported from `@cosmicdrift/kumiko-dev-server` — Zod-object covering the vars read by framework-core: `PORT` (default `"3000"`), `DATABASE_URL`, `REDIS_URL`, `KUMIKO_INSTANCE_ID`, `KUMIKO_SKIP_ES_OPS`. `DATABASE_URL` + `REDIS_URL` carry `.meta({ kumiko: { pulumi: { secret: true } } })` so `KUMIKO_DRY_RUN_ENV=pulumi` emits `--secret` flags. Plus `FrameworkCoreEnv` type via `z.infer`. `NODE_ENV` is excluded: build-prod-bundle inlines it as a literal at build-time (esbuild define), so runtime env-validation can't observe it.
- `composeEnvSchema({ core, features, extend, optionalFeatures })` accepts a new `core?` option. Keys from `core` are tagged with source `"framework-core"` in the resulting sources map and in `KumikoBootError.format()` output. Conflict detection runs across core/features/extend — a feature or `extend` block that re-declares a core var throws `KumikoBootError` at compose-time.

**Why:** Phase 1 of the Sprint 9 env-schema migration (`kumiko-studio/docs/plans/sprint-9-env-schemas.md`). Apps wire `composeEnvSchema({ core: frameworkCoreEnvSchema, features, extend })` into `runProdApp` to get aggregated boot-validation for the vars that framework-core reads. `KUMIKO_DRY_RUN_ENV=pulumi|k8s` then enumerates them with source attribution per row — operators see "(framework-core)" next to `DATABASE_URL` rather than guessing whether the framework or the app is the consumer.

**Backward-compat:** Purely additive. `runProdApp`'s existing `requireEnv("DATABASE_URL")` / `process.env["KUMIKO_INSTANCE_ID"]` reads remain unchanged. Apps that don't pass `envSchema` behave exactly as before.

**Feature-specific vars (Phase 2):** `JWT_SECRET` (auth-email-password), `KUMIKO_SECRETS_MASTER_KEY_*` (secrets), `SMTP_*` (channel-email-smtp), `STRIPE_*` / `MOLLIE_*` (subscription-*) stay scoped to their owning feature's `r.envSchema()` and are NOT in `frameworkCoreEnvSchema`.

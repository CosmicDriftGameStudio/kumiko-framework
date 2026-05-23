# use-all-bundled

Canonical smoke-sample. Mounts every bundled-feature so framework-CI catches feature-coverage gaps that real apps (which mount only what they use) silently miss.

## Why

Sprint 9.8 found 12 framework-bugs in Studio's deploy that all could have been caught earlier: 27 of 30 bundled-features had zero integration-coverage from any real app. This sample is the gate. See `kumiko-platform/docs/plans/features/use-all-features-smoke.md`.

## CI-Gate Hierarchy

Two CI-jobs guard `release`. They form a hierarchy — the cheap one runs first, the expensive one runs only if the first passes.

| Layer | Job | What it catches |
|---|---|---|
| **Pre-flight sanity** | `use-all-bundled-smoke` | feature-wiring bugs: `Object.entries(undefined)`, self-extension, missing-requires, schema-Validators, `composeFeatures` failures. **No DB**. Boot exits after `createRegistry`. |
| **Real gate** | `use-all-bundled-postgres-smoke` | everything above **plus** schema-drift, `tierResolverUsage.plugin.build({ db, registry })`, `assertSchemaCurrent`, idempotency/dedup wiring, and `GET /health` endpoint. **postgres+redis service containers**. |

**Boot-mode coverage gap to be aware of**: `KUMIKO_DRY_RUN_ENV=boot` exits **before** the `tierResolverUsage.plugin.build`-loop, so tier-resolver-plugin bugs only surface in `postgres-smoke`. If you ship a Sprint-9.8-style fix that touches tier-engine internals, rely on the postgres-smoke as the truth-gate, not the pre-flight.

## Boot-test (no DB, pre-flight)

```sh
KUMIKO_DRY_RUN_ENV=boot \
  DATABASE_URL=postgres://dummy:dummy@127.0.0.1:1/dummy \
  REDIS_URL=redis://127.0.0.1:1 \
  JWT_SECRET=$(openssl rand -base64 32) \
  KUMIKO_SECRETS_MASTER_KEY_V1=$(openssl rand -base64 32) \
  bun samples/apps/use-all-bundled/bin/main.ts
```

Exits 0 on success; any feature-wiring fault throws and exits 1.

## Postgres-smoke (real gate)

```sh
# Erst postgres + redis lokal starten (z.B. via docker):
# docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=smoke -e POSTGRES_USER=smoke -e POSTGRES_DB=smoke postgres:18-alpine
# docker run -d --name rd -p 6379:6379 redis:8-alpine

DATABASE_URL=postgres://smoke:smoke@127.0.0.1:5432/smoke \
  REDIS_URL=redis://127.0.0.1:6379 \
  JWT_SECRET=$(openssl rand -base64 32) \
  KUMIKO_SECRETS_MASTER_KEY_V1=$(openssl rand -base64 32) \
  bash samples/apps/use-all-bundled/scripts/smoke-postgres.sh
```

Migrates schema, spawns the server, curls `/health` until 200.

## Coverage status

29/39 bundled-feature exports mounted, 10 held-back (siehe `scripts/check-coverage.ts` → `EXPECTED_HELD_BACK`). Die 10:

- `auth-email-password` — auto-mounted via `composeFeatures(authOptions)` (no need to list in `APP_FEATURES`)
- `channel-email`, `channel-push` — need provider-options
- `mail-transport-smtp` — needs `SMTP_HOST`/`USER`/`PASS`
- `file-provider-s3`, `files-provider-s3` — need S3 creds
- `subscription-stripe`, `subscription-mollie` — need provider keys
- `feature-toggles` — needs `FeatureTogglesOptions` shape
- `foundation-shared` — pure utilities, no `defineFeature`

M0.1 will reduce this list by mounting each with minimal-stub options.

## Maintenance

When you add a new feature-export to `@cosmicdrift/kumiko-bundled-features` you MUST either:

1. Mount it in `src/run-config.ts` AND add a `FEATURE_IMPORT_REGISTRY` entry in `drizzle/generate.ts`. Then re-run:
   ```sh
   bun samples/apps/use-all-bundled/drizzle/generate.ts
   cd samples/apps/use-all-bundled && bunx drizzle-kit generate
   ```
2. Or, if the feature is not yet smoke-ready, add it to `EXPECTED_HELD_BACK` in `scripts/check-coverage.ts` with a one-line reason.

CI fails otherwise via `Coverage lint (M5)`.

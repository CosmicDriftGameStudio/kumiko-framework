# use-all-bundled

Canonical smoke-sample. Mounts every bundled-feature so framework-CI catches feature-coverage gaps that real apps (which mount only what they use) silently miss.

## Why

Sprint 9.8 found 12 framework-bugs in Studio's deploy that all could have been caught earlier: 27 of 30 bundled-features had zero integration-coverage from any real app. This sample is the gate. See `kumiko-platform/docs/plans/features/use-all-features-smoke.md`.

## CI-Gate

The `use-all-bundled-smoke` job guards `release`. It boots the sample with `KUMIKO_DRY_RUN_ENV=boot` (no DB) so feature-wiring bugs surface before publish.

| Job | What it catches |
|---|---|
| `use-all-bundled-smoke` | feature-wiring bugs: `Object.entries(undefined)`, self-extension, missing-requires, schema-Validators, `composeFeatures` failures. **No DB**. Boot exits after `createRegistry`. |

DB-backed boot (schema apply for every bundled feature against real Postgres + Redis, dispatcher round-trip) is gated by `src/__tests__/full-stack-boot.integration.test.ts` in the non-blocking `integration` CI-job. The prod-only paths (`assertSchemaCurrent`, `GET /health`) run in `packages/dev-server`'s `run-prod-app.integration.test.ts` — not against this sample's feature set.

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

## Coverage status

36/39 bundled-feature exports mounted, 3 held-back. M0.1 reduced this from 10. Held-back nach M0.1:

- `auth-email-password` — auto-mounted via `composeFeatures(authOptions)` (no need to list)
- `files-provider-s3` — utility helpers (`createS3Provider`), kein `defineFeature`
- `foundation-shared` — pure utilities (`requireDefined`, `requireNonEmpty`), kein `defineFeature`

The 3 remaining are utilities or auto-mounted — they cannot be added to `APP_FEATURES` by design.

## Maintenance

When you add a new feature-export to `@cosmicdrift/kumiko-bundled-features` you MUST either:

1. Mount it in `src/run-config.ts`. `kumiko/schema.ts` picks up entities via
   `composeFeatures(APP_FEATURES)` — then regenerate if schema changed:
   ```sh
   cd samples/apps/use-all-bundled
   bun ../../bin/kumiko.ts schema generate feature-coverage
   ```
2. Or, if the feature is not yet smoke-ready, add it to `EXPECTED_HELD_BACK` in `scripts/check-coverage.ts` with a one-line reason.

CI fails otherwise via `Coverage lint (M5)`.

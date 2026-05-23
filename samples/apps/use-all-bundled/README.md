# use-all-bundled

Canonical smoke-sample. Mounts every bundled-feature so framework-CI catches feature-coverage gaps that real apps (which mount only what they use) silently miss.

## Why

Sprint 9.8 found 12 framework-bugs in Studio's deploy that all could have been caught earlier: 27 of 30 bundled-features had zero integration-coverage from any real app. This sample is the gate. See `kumiko-platform/docs/plans/features/use-all-features-smoke.md`.

## Boot-test (no DB)

```sh
yarn workspace @cosmicdrift/kumiko-sample-use-all-bundled run boot
```

Equivalent to:

```sh
KUMIKO_DRY_RUN_ENV=boot \
  DATABASE_URL=postgres://dummy:dummy@127.0.0.1:1/dummy \
  REDIS_URL=redis://127.0.0.1:1 \
  JWT_SECRET=$(openssl rand -base64 32) \
  KUMIKO_SECRETS_MASTER_KEY_V1=$(openssl rand -base64 32) \
  bun bin/main.ts
```

Runs env-validation + composeFeatures + validateBoot + createRegistry. Exits 0 on success; any feature-wiring fault (Object.entries(undefined), self-extension, UNIQUE-tenantId, missing-requires, …) throws and the process exits 1.

## Coverage status

M0 mounts the no-args / pre-created / minimal-opts features (~28). Held back for M0.1:

- `channel-email`, `channel-push` — need provider-options
- `mail-transport-smtp` — needs `SMTP_HOST/USER/PASS`
- `file-provider-s3`, `files-provider-s3` — need S3 creds
- `subscription-stripe`, `subscription-mollie` — need provider keys
- `feature-toggles` — needs `FeatureTogglesOptions` shape

Each gets mounted with minimal stub options in M0.1 once the boot-mode contract is proven against the easy set.

## Auth

`auth-email-password` is auto-mounted by `composeFeatures` when `runProdApp` is called with `auth: {…}`. This sample boots **without** an `auth` option (boot-mode doesn't run web routes), so auth-email-password is not in `APP_FEATURES`. M0.1 adds an auth-mode boot to cover that path too.

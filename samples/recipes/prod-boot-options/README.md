# Prod boot options

Declare mail, KMS, file storage, demo mode, seeds and signal handling as
`runProdApp` options instead of wiring them by hand in `bin/main.ts`. Each
option mounts the matching bundled feature, reads its env block and fails
the boot with a clear message when the env is incomplete.

## What it shows

- **`mail`**: `{ transport: "smtp-env" }` mounts `channel-email` with an
  SMTP transport from `SMTP_*` and makes the auth mail flows use it.
  `"inmemory"` is for dev and tests and is rejected in production.
- **`kmsMode`**: `"required"` builds the KMS adapter and blind-index key from
  `PLATFORM_KEK`, `SUBJECT_KEYS_DATABASE_URL` and `KUMIKO_BLIND_INDEX_KEY` and
  aborts without them. `"optional"` uses them when present.
  `{ plaintextReason }` stores PII in plaintext on purpose.
- **`fileStorage`**: `{ provider: "auto" }` mounts the S3 provider when
  `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` are complete. In
  production a partial S3 env aborts the boot; in dev it falls back to
  in-memory storage.
- **`demoMode`**: `GET /demo-mode` publishes the notice, and `readOnly: true`
  answers every write except query and login with `403 demo_read_only`.
- **`signals`**: SIGTERM and SIGINT run `stop()` with a drain timeout, then
  exit 0, or exit 1 on timeout or error. `signals: false` leaves the process
  signals to the host.
- **`seeds`**: `{ demoTenant, demoAdminFromEnv, sysadminFromEnv, run }`
  replaces hand-written tenant and admin seeds; needs the auth features (not
  mounted here).
- **`billing`**: `{ stripe: { priceToTier }, defaultTier }` mounts the Stripe
  bridge and the tier-sync webhook route; needs the billing set from
  `composeSaasStack`.

## Flow

1. `src/app.ts` lists the features and the boot options.
2. `bin/server.ts` passes both to `runProdApp`.
3. The test boots with `KUMIKO_DRY_RUN_ENV=boot`, which runs the full
   validation and exits before any DB or Redis connection: a complete
   production env passes, and a missing S3, SMTP or KMS key aborts the boot.

## Run

```bash
bun test samples/recipes/prod-boot-options
```

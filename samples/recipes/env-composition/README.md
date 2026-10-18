# Env composition

Build the app's env schema from the blocks the mounted features register,
instead of keeping a hand-written copy of every feature's variables.

## What it shows

- **Feature blocks**: `createSecretsFeature`, `createCryptoShreddingFeature`
  and `createFileProviderS3Feature({ fromEnv: true })` register `secretsEnvSchema`,
  `kmsEnvSchema` and `s3EnvSchema`. `composeEnvSchema` collects them and
  records which feature declared each variable.
- **App-level blocks in `extend`**: `buildInfoEnvSchema`, `demoAdminEnvSchema`,
  `stripeEnvSchema({ prices })` and `createS3EnvSchema({ prefix })` for a
  second bucket. These belong to no mounted feature, so the app adds them.
- **Typed result**: `parseEnv(composed.schema, …)` returns the merged type,
  so `parsed.S3_BUCKET` is `string | undefined` and `parsed.APP_PUBLIC_URL` is
  `string` without a cast.
- **Error report**: a missing required variable is listed with its source
  (`secrets`, `app`, …).

## Blocks

| Block | Where it lives | Registered by |
| --- | --- | --- |
| `kmsEnvSchema` | `crypto-shredding` | `createCryptoShreddingFeature()` |
| `smtpEnvSchema` | `channel-email` | `createChannelEmailFeature()` |
| `s3EnvSchema`, `createS3EnvSchema({ prefix })` | `file-provider-s3` | `createFileProviderS3Feature({ fromEnv: true })` |
| `stripeEnvSchema({ prices })` | `subscription-stripe` | app (`extend`); the feature registers the bridge keys |
| `mfaTokenSecretsEnvSchema` | `auth-mfa` | `createAuthMfaFeature()` |
| `buildInfoEnvSchema`, `demoAdminEnvSchema` | `foundation-shared` | app (`extend`) |
| `prometheusMetricsEnvSchema` | `framework/observability` | app (`extend`) |

## When to reach for it

Every app that boots with `runProdApp`. Pass the composed schema as
`envSchema` and read the parsed values instead of `process.env`.

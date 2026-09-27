---
"@cosmicdrift/kumiko-testing": minor
---

`SCHEMA_ENV_DEFAULTS` (`JWT_SECRET`, `KUMIKO_SECRETS_MASTER_KEY_V1`, `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION`) is now preloaded by every `kumiko-testing bunfig` variant — unit and DOM via the new `preload/schema-env-defaults`, integration via `preload/env`, real via `preload/real` — each filled with `??=` so an app's own value wins — except a `JWT_SECRET` shorter than 32 characters, which is replaced like the app-local preloads did. Previously only integration and real got a `JWT_SECRET` default (from `SERVICE_ENV_DEFAULTS`, which no longer carries it — `SCHEMA_ENV_DEFAULTS` is now its single source), and no variant defaulted the secrets master key, forcing every app with the secrets/field-encryption/auth-mfa features to hand-roll its own test preload for these framework-schema keys. Unit and DOM still get no service-endpoint defaults (`DATABASE_URL`, `REDIS_URL`, …) — an accidental infra call in a unit test still fails instead of silently connecting. Regenerate with `kumiko-testing bunfig` to pick up the new preload entry.

<!-- kumiko-changes
feature: testing
type: improvement
title: Schema-required test env keys (JWT_SECRET, secrets master key) now default in every bunfig variant
detail: |
  Apps with the secrets, field-encryption or auth-mfa features previously had
  to hand-roll a `test-setup/env.preload.ts` to satisfy the env schema's
  `JWT_SECRET` and `KUMIKO_SECRETS_MASTER_KEY_*` in unit and DOM tests, since
  only `SERVICE_ENV_DEFAULTS` (integration/real only) carried a `JWT_SECRET`
  default and no map carried the master key. The new `SCHEMA_ENV_DEFAULTS`
  map lives next to `SERVICE_ENV_DEFAULTS` and is preloaded in all four bunfig
  variants (unit, DOM, integration, real) via a new `preload/schema-env-defaults`
  module, filled with `??=` so an app's own value is kept; only a
  `JWT_SECRET` shorter than 32 characters is replaced.
  `SERVICE_ENV_DEFAULTS` no longer duplicates `JWT_SECRET` — it has one home
  now. Unit and DOM still carry no service-endpoint defaults.
-->

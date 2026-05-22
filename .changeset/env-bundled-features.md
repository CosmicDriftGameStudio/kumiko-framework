---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add env-var contracts for four bundled-features (Sprint 9.3, Migration Phase 2).

**New API:**

- `secretsEnvSchema` — `KUMIKO_SECRETS_MASTER_KEY_V1` (base64-32 KEK, refined for length) + `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION` (default `"1"`).
- `authEmailPasswordEnvSchema` — `JWT_SECRET` (≥32 chars) + `JWT_ISSUER` (optional).
- `subscriptionStripeEnvSchema` — `STRIPE_WEBHOOK_SECRET` + `STRIPE_API_KEY` (both non-empty, both `pulumi.secret=true`).
- `subscriptionMollieEnvSchema` — `MOLLIE_API_KEY` (`test_` or `live_` prefix, `pulumi.secret=true`).

Each schema is exported from its feature's barrel and attached via `r.envSchema(...)` at feature-mount-time. Apps that mount these features via `composeEnvSchema({ features, ... })` get aggregated boot-validation for the relevant env-vars with source-attribution (`(auth-email-password)`, `(secrets)`, `(subscription-stripe)`, `(subscription-mollie)`).

**Plan-Doc-Drift dokumentiert:** `mail-transport-smtp` bekommt KEIN envSchema. SMTP_HOST/PORT/SECURE/FROM/AUTH-USER sind tenant-config, SMTP_PASSWORD ist tenant-secret via `r.secret()` — keine process.env-Vars im Feature. Apps die SMTP_HOST etc. aus env seeden, deklarieren das in ihrem `extend`-block.

**Kumiko-Pattern:** Das schema ist Contract, nicht Doku. Wenn eine App die var anders nennt (z.B. `MY_JWT` statt `JWT_SECRET`), ist sie off-pattern — `composeEnvSchema` würde sie unter dem standardisierten Namen erwarten.

**Backward-compat:** Purely additive. Apps ohne `composeEnvSchema({features})` behavior unverändert.

---
"@cosmicdrift/kumiko-bundled-features": minor
---

subscription-stripe: Stripe-Keys + billing-live zur Laufzeit aus config/secrets

Der `subscription-stripe`-Plugin liest seine Credentials jetzt **zur Laufzeit** statt aus einem mount-time-Closure — Keys rotieren und prod geht live ohne Redeploy.

- `subscription-stripe:secret:api-key` + `:webhook-secret` → **secrets** (encrypted-at-rest, unter `SYSTEM_TENANT_ID` da app-wide).
- `subscription-stripe:config:billingLive` → **system config** (boolean, default `false`). Master-Switch: `createCheckoutSession` wirft `feature_disabled` solange `billingLive` nicht `true` ist — `sk_test_`-Keys in prod erzeugen damit nie einen live-Checkout.
- Das Feature requires jetzt zusätzlich `config` + `secrets` und mountet **immer** (kein key-presence-Guard mehr). Die factory-options `apiKey`/`webhookSecret` sind jetzt **optional** und dienen nur noch als env→secrets-Bridge-Fallback; `priceToTier` bleibt eine factory-option.

`billing-foundation`: `SubscriptionProviderPlugin.verifyAndParseWebhook` bekommt einen optionalen 3. Parameter (system-scoped `SecretsContext`), den der webhook-handler durchreicht (`SubscriptionWebhookDeps.systemSecrets`). Damit lesen Provider ihre app-wide-Secrets pre-tenant zur Laufzeit. Additiv + backward-compatible — `subscription-mollie` ignoriert den Param.

---
"@cosmicdrift/kumiko-bundled-features": minor
---

subscription-stripe: declare the Stripe credentials as `backing:"secrets"` config keys (auto-derived settings screen)

The Stripe API key + webhook secret move from hand-rolled `r.secret`
declarations to system config keys with `backing:"secrets"`
(`subscription-stripe:config:api-key` / `:webhook-secret`). Each carries a
`mask`, so the config feature derives the sysadmin settings screen + Settings-Hub
nav automatically — consuming apps no longer hand-write a Stripe-config screen,
its query/set handlers, or the QN-contract constants. `billingLive` gains a
`mask` too (write `["system", "SystemAdmin"]`) so the same derived screen
flips go-live.

The value still lives envelope-encrypted in the secrets store under the system
tenant; reads round-trip through `SecretsContext.get(config-QN)` (the webhook
path stays context-less + un-audited, now JSON-parsing the stored config value).
The `apiKey` / `webhookSecret` factory options remain as env→secrets bridge
fallbacks.

**BREAKING (operator action on deploy):** the secret-store key name changes
from `subscription-stripe:secret:<name>` to `subscription-stripe:config:<name>`,
so the existing prod values are not read by the new declaration. After deploying,
re-enter the Stripe API key + webhook secret once via the derived sysadmin
settings screen (or `config:write:set`). `billingLive` is unaffected (it stays a
config key under the same name). No data migration is required — the keys are
simply re-entered.

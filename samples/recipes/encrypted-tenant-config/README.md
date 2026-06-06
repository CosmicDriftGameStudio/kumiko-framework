# Recipe: Encrypted per-tenant config

**What this shows:** how a SaaS customer stores their own API key
(Stripe, Slack webhook, SMTP password …) in their settings, without
the platform operator being able to read the plaintext from the DB.

## Pattern

```ts illustration
import { access, createTenantConfig } from "@cosmicdrift/kumiko-framework/engine";

createTenantConfig("text", {
  encrypted: true,        // ← ciphertext in the DB
  write: access.admin,    // ← the tenant admin writes their own
  read: access.admin,     // ← nobody else sees it
});
```

The config resolver decrypts on the `ctx.config(handle)` call using
the `EncryptionProvider` from `extraContext.configEncryption`. Anyone
without the master key (= the `CONFIG_ENCRYPTION_KEY` env) only sees
base64 AES ciphertext in the DB.

## Use cases

- **Per-tenant API keys** — Customer A uses THEIR Stripe account,
  Customer B uses THEIRS. The platform operator never makes Stripe
  calls on behalf of customers.
- **Webhook secrets** — per-tenant Slack/Discord incoming webhook URL.
- **SMTP credentials** — per-tenant mail server (see
  `samples/showcases/publicstatus` Phase 2).

## Vs. `r.secret` / `samples/recipes/secrets-demo`

| Pattern | Scope | Use case |
|---|---|---|
| **`r.secret`** (envelope encryption, KEK rotation) | App-global | Platform-owned secrets (e.g. the master Stripe key that bills ALL customers). |
| **`encrypted: true` config key** (this recipe) | Per-tenant | Customer-owned secrets. Customer sets, rotates, and never sees another customer's. |

Combinable: the platform uses `r.secret` for its internal secrets,
and in parallel customers have their tenant-owned `encrypted: true`
config keys.

## Boot wiring

```ts illustration
import { createConfigResolver } from "@cosmicdrift/kumiko-bundled-features/config";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";

const encryption = createEncryptionProvider(process.env.CONFIG_ENCRYPTION_KEY);
const configResolver = createConfigResolver({ encryption });

await runProdApp({
  extraContext: ({ registry }) => ({
    configResolver,
    configEncryption: encryption,  // ← required for encrypted keys
    _configAccessorFactory: createConfigAccessorFactory(registry, configResolver),
  }),
  // ...
});
```

## Security guarantees

1. **DB plaintext-free:** `SELECT value FROM config_values WHERE key = 'stripe-api-key'` returns ONLY ciphertext. Backup files, DB dumps, postgres eavesdropping → no plaintext leak.
2. **UI mask:** `config:query:values` returns `"••••••"` for encrypted keys. Even the admin allowed to SET the value doesn't see it back. (If you need the value, go through `ctx.config(handle)` in the backend, not through the UI.)
3. **Tenant isolation:** every tenant has its own entry — `(key, tenantId)` is unique in the config feature. Customer A NEVER sees Customer B's API key.

## What's not in this recipe

- **Key rotation:** the `CONFIG_ENCRYPTION_KEY` is app-global, rotation requires decrypt-old + encrypt-new per entry. Non-trivial. If you need it: `samples/recipes/secrets-demo` shows envelope encryption with KEK rotation for app-global secrets.
- **Audit trail:** secrets-demo tracks every secret read as an event. Not here — config keys are meant as "settings" (read frequent, audit overkill).
- **Backup encryption:** `CONFIG_ENCRYPTION_KEY` must be backed up alongside every backup, otherwise the DB is worthless after restore. Operator's job.

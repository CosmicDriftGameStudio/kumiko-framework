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
  mask: { title: "billing.stripe-api-key", order: 1 },  // ← derives the edit screen + nav
});
```

The config resolver decrypts on the `ctx.config(handle)` call using
the `EncryptionProvider` from `extraContext.configEncryption`. Anyone
without the master key (= the `KUMIKO_SECRETS_MASTER_KEY_V<n>` env) only sees
base64 AES ciphertext in the DB.

The `mask` entry is all the UI needs: `buildConfigFeatureSchema` derives
the `configEdit` screen (pre-filled from `config:query:values`, where the
key comes back as `••••••`) **and** its Settings-Hub nav entry from the
registered key — no hand-written `r.screen`/`r.nav`. `mask.title` is the
i18n key of the field label, `mask.order` its position.

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
| **`encrypted: true` config key** (this recipe) | Per-tenant | Customer-owned secrets. Customer sets, rotates, and never sees another customer's. Same envelope encryption + KEK keyring under the hood. |

Combinable: the platform uses `r.secret` for its internal secrets,
and in parallel customers have their tenant-owned `encrypted: true`
config keys.

## Boot wiring

None. `runProdApp` / `runDevApp` wire the envelope cipher automatically as
soon as a master key is present in the environment:

```bash illustration
KUMIKO_SECRETS_MASTER_KEY_V1=$(openssl rand -base64 32)
```

That single key drives `encrypted: true` config keys, `r.secret`, and
encrypted entity fields — one keyring, one rotation story. Only tests or
custom boots pass their own cipher:

```ts illustration
import { createConfigResolver } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";

const cipher = createTestEnvelopeCipher();
const configResolver = createConfigResolver({ cipher });
// extraContext: { configResolver, configEncryption: cipher, ... }
```

## Flow

1. Tenant admin sets `stripe-api-key` via `config:write:set` (scope tenant).
2. DB row holds a JSON envelope (AES-GCM ciphertext + wrapped DEK + `kekVersion`) — backups and `SELECT` leak nothing.
3. `config:query:values` returns `••••••` for the encrypted key in the UI.
4. Domain handler calls `ctx.config(handle)` → decrypted value in-process.
5. Tenant B cannot charge with Tenant A's key — per-tenant config row isolation.

## Security guarantees

1. **DB plaintext-free:** `SELECT value FROM config_values WHERE key = 'stripe-api-key'` returns ONLY ciphertext. Backup files, DB dumps, postgres eavesdropping → no plaintext leak.
2. **UI mask:** `config:query:values` returns `"••••••"` for encrypted keys. Even the admin allowed to SET the value doesn't see it back. (If you need the value, go through `ctx.config(handle)` in the backend, not through the UI.)
3. **Tenant isolation:** every tenant has its own entry — `(key, tenantId)` is unique in the config feature. Customer A NEVER sees Customer B's API key.

## Tests

```bash
bun test src/__tests__/feature.integration.test.ts
```

Proves:

- DB stores ciphertext, not plaintext
- UI query masks encrypted values
- Charge handler reads decrypted key and succeeds only when set
- Tenant A's key does not leak to Tenant B
- `mask` derives the `configEdit` screen without hand-written `r.screen`

## Key rotation

Config values carry their `kekVersion`, so rotation is operational, not
cryptographic surgery:

1. Add `KUMIKO_SECRETS_MASTER_KEY_V2` to the environment (old key stays).
2. Set `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION=2` — new writes use V2,
   old rows still decrypt via the keyring.
3. Trigger the manual `config:reencrypt` job — it re-encrypts every
   encrypted config row onto the current version (and migrates any
   pre-envelope legacy rows). Idempotent, chunked, circuit-breaker on
   repeated failures.
4. Only after the job reports `failed: 0` remove V1 from the environment.

The same job doubles as the migration path away from the deprecated
single-key `CONFIG_ENCRYPTION_KEY` format: keep the old env var as the
decrypt fallback until the job has run once, then delete it.

## What's not in this recipe

- **Audit trail:** secrets-demo tracks every secret read as an event. Not here — config keys are meant as "settings" (read frequent, audit overkill).
- **Backup encryption:** the `KUMIKO_SECRETS_MASTER_KEY_V<n>` keyring must be backed up alongside every backup, otherwise the DB is worthless after restore. Operator's job.

## Related samples

- [managed-config](/en/samples/recipes-managed-config/) — `backing: "secrets"`
  for platform-owned keys + tenant cascade for SMTP defaults.
- [apps-cap-billing-demo](/en/samples/apps-cap-billing-demo/) — billing
  handlers that read per-tenant Stripe keys.

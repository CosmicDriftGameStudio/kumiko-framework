# Recipe: Managed config

**What this shows:** how one declarative config surface provisions everything a
key needs — storage, masking, cascade, and a settings-hub entry — across two
backings and two scopes, without a hand-written screen, nav, or env-wiring map.

Two keys, deliberately different:

| Key | Scope | Backing | Story |
|---|---|---|---|
| `payment-api-key` | `system` | `secrets` | Platform-owned secret (one Stripe key bills all tenants). Stored envelope-encrypted in the secrets store, masked in every query, revealed only for the owning feature's `ctx.config` read. |
| `smtp-host` | `tenant` | config | Platform default that a tenant admin overrides. Cascade resolves `tenant-row → system-row → default`; one tenant's override never leaks to another. |

## Pattern

```ts illustration
import { access, createSystemConfig, createTenantConfig } from "@cosmicdrift/kumiko-framework/engine";

r.config({
  keys: {
    // System-only secret: storage routes to the secrets envelope (KEK rotation
    // + audit-on-read), never config_values. backing:"secrets" is system-only —
    // the boot-guard rejects it on tenant/user scope (secrets has no cascade).
    "payment-api-key": createSystemConfig("text", {
      backing: "secrets",
      write: access.systemAdmin,
      read: access.admin,
      mask: { title: "integrations.payment-api-key", icon: "credit-card", order: 1 },
    }),
    // Tenant override with a platform default sourced from an env var at boot.
    "smtp-host": createTenantConfig("text", {
      env: "SMTP_HOST",
      default: "smtp.platform.example",
      write: access.roles("SystemAdmin", "Admin"),
      read: access.admin,
      mask: { title: "integrations.smtp-host", icon: "mail", order: 2 },
    }),
  },
});
```

## What each option provisions

- **`backing: "secrets"`** — the value lives in the secrets store (envelope
  encryption, KEK rotation, audit-on-read) instead of `config_values`. Set/read/
  reset dispatch through `ctx.secrets`; the query handlers mask the value while
  the owning feature still reads the revealed plaintext via `ctx.config`. Only
  valid for `scope: "system"` — secrets are flat per `(tenant, key)` with no
  cascade, so a tenant override would be incoherent and is rejected at boot.
- **`env: "SMTP_HOST"`** — at boot (`runProdApp`) the env var seeds the key's
  default as an app-override, below any `system-row`. The env var *is* the
  default; no manual `AppConfigOverrides` map, no re-typing in the admin UI.
- **`mask`** — the key surfaces automatically in the self-populating settings
  hub: `buildConfigFeatureSchema` derives a `configEdit` screen + a child nav
  under the audience hub (Platform / Organisation / Personal) from the key's
  scope and type. No `r.screen`, no `r.nav`. `mask.title` is the i18n label key.

## Boot wiring

```ts illustration
import {
  createConfigAccessorFactory,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";

const masterKeyProvider = createEnvMasterKeyProvider({ env: process.env });
const resolver = createConfigResolver();

await runProdApp({
  extraContext: ({ db, registry }) => ({
    configResolver: resolver,
    _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    // Required whenever a key declares backing:"secrets" — without it the set
    // and read paths fail loud, never silently miss.
    secrets: createSecretsContext({ db, masterKeyProvider }),
  }),
  // ...
});
```

Register the `secrets` feature too so its `tenant_secrets` table is migrated;
the config backing only needs the `ctx.secrets` context shown above.

## Vs. the neighbouring recipes

| Pattern | Storage | Cascade | Use case |
|---|---|---|---|
| **`encrypted: true` config key** (`encrypted-tenant-config`) | `config_values`, AES ciphertext | system → tenant | Per-tenant customer secret, no KEK rotation/audit. |
| **`backing: "secrets"` config key** (this recipe) | secrets envelope, system tenant | none (system-only) | Platform-owned secret needing rotation + audit-on-read, declared as a config key. |
| **`r.secret`** (`secrets-demo`) | secrets envelope | none | Same storage, but addressed directly — no config key, no settings-hub entry. |

`backing: "secrets"` is the bridge: you get the secrets store's guarantees
*and* the config feature's declarative surface (masking, settings hub, the same
`config:write:set` write path).

## What's not in this recipe

- **Tenant-scoped secrets** — forbidden by declaration. `backing: "secrets"` +
  `scope: "tenant"`/`"user"` fails at boot; use `encrypted: true` for a
  cascading per-tenant secret.
- **The env→default bridge at runtime** — `env:` is wired by `runProdApp`, not
  by `setupTestStack`, so the integration test sets the platform default
  explicitly via a `scope: "system"` write rather than through the env var.

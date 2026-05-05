# Recipe: Encrypted per-tenant config

**What this shows:** wie ein SaaS-Customer seinen eigenen API-Key (Stripe,
Slack-webhook, SMTP-pass …) selbst in Settings speichert, ohne dass der
Plattform-Operator den Klartext aus der DB lesen kann.

## Pattern

```ts
import { access, createTenantConfig } from "@cosmicdrift/kumiko-framework/engine";

createTenantConfig("text", {
  encrypted: true,        // ← ciphertext in der DB
  write: access.admin,    // ← tenant-admin schreibt seinen eigenen
  read: access.admin,     // ← niemand sonst sieht ihn
});
```

Der config-resolver entschlüsselt beim `ctx.config(handle)`-call mit dem
`EncryptionProvider` aus `extraContext.configEncryption`. Wer den
Master-Key (= `CONFIG_ENCRYPTION_KEY` env) NICHT hat, sieht in der DB nur
base64-AES-ciphertext.

## Use-cases

- **Per-Tenant API-Keys** — Customer A nutzt SEIN Stripe-Konto, Customer B
  SEINS. Plattform-Operator führt KEINE Stripe-Calls für Customer aus.
- **Webhook-Secrets** — pro Tenant ein eigener Slack/Discord-incoming-
  webhook-URL.
- **SMTP-Credentials** — pro Tenant ein eigener Mailserver (siehe
  `samples/showcases/publicstatus` Phase 2).

## Vs. `r.secret` / `samples/recipes/secrets-demo`

| Pattern | Scope | Use-case |
|---|---|---|
| **`r.secret`** (envelope-encryption, KEK-rotation) | App-global | Plattform-eigene secrets (z.B. der Master-Stripe-Key der ALLE customers abrechnet). |
| **`encrypted: true` config-key** (dieses recipe) | Per-tenant | Customer-eigene secrets. Customer setzt selbst, rotiert selbst, sieht keinen anderen Customer. |

Kombinierbar: Plattform nutzt `r.secret` für ihre internal-secrets, und
parallel haben Customer ihre tenant-eigenen `encrypted: true` config-keys.

## Boot-Wiring

```ts
import { createConfigResolver } from "@cosmicdrift/kumiko-bundled-features/config";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";

const encryption = createEncryptionProvider(process.env.CONFIG_ENCRYPTION_KEY);
const configResolver = createConfigResolver({ encryption });

await runProdApp({
  extraContext: ({ registry }) => ({
    configResolver,
    configEncryption: encryption,  // ← Pflicht für encrypted-keys
    _configAccessorFactory: createConfigAccessorFactory(registry, configResolver),
  }),
  // ...
});
```

## Sicherheits-Garantien

1. **DB-Klartext-Free:** `SELECT value FROM config_values WHERE key = 'stripe-api-key'` returnt NUR ciphertext. Backup-files, DB-Dumps, postgres-eavesdropping → kein Klartext-Leak.
2. **UI-Mask:** `config:query:values` returnt `"••••••"` für encrypted-keys. Auch der Admin der den Wert SETZEN darf, sieht ihn nicht zurück. (Wer den Wert braucht, geht über `ctx.config(handle)` im backend, nicht über die UI.)
3. **Tenant-Isolation:** jeder Tenant hat seinen eigenen Eintrag — `(key, tenantId)` ist im config-feature unique. Customer A sieht NIE Customer B's API-Key.

## Was nicht in diesem Recipe ist

- **Key-Rotation:** der CONFIG_ENCRYPTION_KEY ist app-global, Rotation erfordert decrypt-old + encrypt-new pro Eintrag. Nicht-trivial. Wer das braucht: `samples/recipes/secrets-demo` zeigt envelope-encryption mit KEK-rotation für app-global secrets.
- **Audit-Trail:** secrets-demo trackt jeden Secret-read als event. Hier nicht — config-keys sind als "settings" gedacht (read frequent, audit overkill).
- **Backup-Encryption:** `CONFIG_ENCRYPTION_KEY` muss bei jedem Backup mitgesichert werden, sonst ist die DB nach restore wertlos. Operator-Pflicht.

---
status: reference
verified: 2026-10-03
evidence: "packages/types/src/feature.ts (SecretKeyDefinition, SecretNamespaceDefinition); packages/framework/src/engine/feature-config-events-jobs.ts (r.secret, r.secretNamespace); packages/bundled-features/src/secrets/write-gate.ts; packages/bundled-features/src/secrets/secret-scope.ts; packages/bundled-features/src/secrets/__tests__/secrets-system-scope.integration.test.ts; packages/framework/src/engine/boot-validator/screens-forms.ts (validateConfigEditSecretField); packages/bundled-features/src/delivery/chat-webhook-sender.ts; packages/bundled-features/src/secrets/__tests__/; packages/framework/src/engine/build-config-feature-schema.ts; packages/renderer/src/app/secrets-edit-body.tsx; packages/renderer/src/app/__tests__/secrets-edit-body-write-roles.test.tsx; packages/feature-ast/src/__tests__/render-roundtrip.test.ts"
---

# Secret keys, secret namespaces and write roles

A feature declares every secret it stores. The secrets API (`secrets:write:set`, `secrets:write:delete`) only accepts declared keys, so a tenant admin cannot plant rows next to the ones a feature owns. There are two ways to declare a key: `r.secret` for one fixed key and `r.secretNamespace` for a family of keys whose last part is picked at runtime.

## Fixed keys: `r.secret`

```ts illustration
const apiKey = r.secret("apiKey", {
  label: { en: "Stripe API key", de: "Stripe-API-Schlüssel" },
  scope: "tenant",
  required: true,
  writeRoles: ["TenantAdmin"],
});

await ctx.services.secrets.get(tenantId, apiKey);
```

The qualified name is `<feature>:secret:<kebab-short-name>`, here `billing:secret:api-key` for a feature named `billing`. Feature code passes the returned handle to `ctx.services.secrets.get`, so it never retypes the string. Fixed keys show up on the generated secrets screen in the settings hub.

## Runtime-named keys: `r.secretNamespace`

Use a namespace when a tenant picks the name, for example one auth token per webhook. Inside a feature named `step-dispatcher`:

```ts illustration
const webhookAuth = r.secretNamespace("webhook-auth", {
  label: { en: "Webhook auth secrets" },
  scope: "tenant",
  writeRoles: ["TenantAdmin"],
  nameSchema: z.string().regex(/^[a-z0-9-]+$/).max(60),
});

webhookAuth.prefix; // "step-dispatcher:webhook-auth."
webhookAuth.keyFor("crm"); // "step-dispatcher:webhook-auth.crm"
```

- The prefix is `<kebab-feature>:<kebab-name>.` and has to be unique across all features. A second feature declaring the same prefix fails at boot.
- A key belongs to the namespace when it starts with the prefix and the rest is not empty. With `nameSchema`, the rest also has to pass that schema. Anything else is rejected with 404 `secrets.errors.unknownKey`.
- Namespace keys are not listed on the generated secrets screen. The feature that owns them brings its own UI, since only it knows which names exist.
- The Designer shows `r.secretNamespace` as its own pattern and can add one. Its form edits the name, label, scope and `writeRoles`. A `nameSchema` or an options constant stays exactly as written in the source, because the form cannot edit Zod code.

## Value validation: `valueSchema`

`valueSchema` on `r.secret` or `r.secretNamespace` is a `ZodType<string>` that `secrets:write:set` runs on the value, after the key and write-role checks. A failing value gets 400 `secrets.errors.invalidValue` on field `value`; the response carries neither the value nor Zod's issues.

- Only new writes through the secrets API are checked. Stored secrets stay as they are, and feature code writing through `ctx.services.secrets.set` is not checked.
- `secrets:write:delete` ignores it.

The chat channels use it to reject a bad address when it is created: the webhook secrets of `channel-slack`, `channel-discord` and `channel-teams` must pass the channel's host allowlist (Discord also the `/api/webhooks/` path), the Telegram bot token must look like `<bot id>:<secret>`. The same checks are exported for app code: `checkChatWebhookTarget`, `chatWebhookUrlSchema` and `resolveChatWebhookTarget` from `delivery`, `isTelegramChatId` and `isTelegramBotToken` from `channel-telegram`.

## Chat channel keys

Each chat channel exports its key, so apps do not retype the strings: `SLACK_SECRET_KEYS`, `DISCORD_SECRET_KEYS` and `TEAMS_SECRET_KEYS` with `webhookPrefix` and `webhookKeyFor(connection)`, and `TELEGRAM_SECRET_KEYS.botToken`.

## System-scope secrets on a configEdit screen

A `configEdit` screen with `scope: "system"` may map `secretKeys`, same as a tenant screen; `scope: "user"` stays rejected at boot. The renderer then sends `scope: "system"` with `secrets:write:set`, `secrets:write:delete` and `secrets:query:list`. The server picks the target itself: with `scope: "system"` the secret lives under `SYSTEM_TENANT_ID`, whatever tenant the SystemAdmin is signed in to. The payload never names a tenant. A caller without the `SystemAdmin` role gets `403 access_denied` on all three handlers, and `list` returns previews only, never values.

The handler access rule still applies first, so an app that offers such a screen must include `SystemAdmin` in the secrets access roles, for example `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. The default rule (`TenantAdmin` only) keeps a human SystemAdmin session out. Values read at runtime via `ctx.services.secrets.get(SYSTEM_TENANT_ID, key)`.

## Write roles

`writeRoles` narrows who may set or delete a key. It works on `r.secret` for one key and on `r.secretNamespace` for every key under the prefix.

- Both checks have to pass: the access rule of the secrets handlers (from `createSecretsFeature`, `{ roles: ["TenantAdmin"] }` by default) and `writeRoles`. A user needs at least one of the listed roles.
- Without `writeRoles`, the handler access alone decides.
- An empty list throws in `defineFeature`, because no user could ever satisfy it.
- A user who passes the handler access but holds none of the write roles gets 403 `secrets.errors.writeDenied`.
- The check covers the HTTP and dispatcher path. Feature code that writes through `ctx.services.secrets.set` is trusted and not checked.

The generated secrets screen hides fixed keys the current user cannot write, so nobody fills in a field that the server would reject. Whether a write goes through is still decided by the server check above.

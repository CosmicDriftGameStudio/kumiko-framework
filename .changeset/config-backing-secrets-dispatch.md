---
"@cosmicdrift/kumiko-framework": minor
---

config: wire the generic `backing:"secrets"` dispatch for system-scoped keys

A config key declared `createSystemConfig(type, { backing: "secrets" })` now
stores and reads its value through the **secrets store** (envelope-encrypted,
audited, at `SYSTEM_TENANT_ID`) instead of the `config_values` projection —
completing the previously declared-but-guard-rejected `backing` field
(framework#333 footgun-guard from #376).

- **Reads** dispatch in the resolver (`get`/`getWithSource`/`getCascade`/
  `getCascadeBatch`): a `backing:"secrets"` key resolves its system rung from
  the secrets store via an injected `ConfigSecretsReader`, threaded per-call
  from the request's `ctx.secrets` (the resolver is framework-auto-created
  while `ctx.secrets` is app-provided — only the request context sees both).
  Internal `ctx.config(handle)` reads receive the revealed plaintext; the
  `values`/`cascade` query handlers mask it like an `encrypted` key so the
  plaintext never reaches the UI. `readiness` gates `required` secrets keys for
  free (it shares `getCascadeBatch`).
- **Writes** dispatch in `config:write:set` / `config:write:reset` into
  `ctx.secrets.set` / `.delete` (system tenant), with the same JSON
  serialization a config row uses so reads round-trip.
- **Boot-guard** (`validateConfigKeyBacking`) now allows system-scoped
  `backing:"secrets"`; the permanent `scope !== "system"` rejection stays
  (secrets are flat per `(tenant,key)` and do not cascade).
- A `backing:"secrets"` read/write without `extraContext.secrets` (+ a
  MasterKeyProvider) throws loud at request time — never silently degrades to
  config-encrypted storage.

Blast-radius zero: no shipped config key declares `backing:"secrets"` today.
The capability is proven end-to-end by a real-HTTP integration test (set →
secrets store, masked cascade/values, revealed internal read, reset clears).

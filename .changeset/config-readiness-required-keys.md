---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Tenant-config readiness: declare required config keys, query what's missing.

- `createTenantConfig("text", { required: true, ... })` — new `required` flag on
  config-key declarations. Semantics: the tenant must supply a real value before
  the owning feature works; for text keys an empty/whitespace value counts as unset.
- New query `config:query:readiness` returns the flat list of required keys that
  still lack a usable value for the calling tenant/user — resolved through the same
  cascade as `ctx.config()`, so it can never drift from what handlers will see.
  No boolean "ready" verdict on purpose: secret-presence is queryable via the
  secrets list-handler; UIs compose both.
- `config:query:schema` now exposes the `required` flag per key (UI form rendering).
- New `UnconfiguredError` (422, code `unconfigured`, i18nKey `errors.unconfigured`)
  subclassing `UnprocessableError` — `requireNonEmpty` throws it instead of a bare
  `Error`, so clients can route the user to the settings screen. `requireDefined`
  now throws `InternalError` (500): undefined there is a registry misconfiguration,
  a developer bug, not a tenant gap.
- `mail-transport-smtp` (host/from/authUser) and `file-provider-s3`
  (bucket/region/accessKeyId) mark their must-configure keys `required: true`.

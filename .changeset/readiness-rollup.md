---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Readiness rollup: one call answers "is this tenant fully configured?" across config AND secrets.

- `r.secret(name, { required: true, ... })` — new `required` flag on secret
  declarations, mirroring the config-key flag. `mail-transport-smtp`
  (smtp.password) and `file-provider-s3` (s3.secretAccessKey) mark theirs.
- `ctx.secrets.has(tenantId, key)` — metadata-only existence probe on
  SecretsContext: no decryption, no `tenantSecretRead` audit event. Use it
  for readiness checks; `get()` stays the audited value read.
- New bundled feature `readiness` (requires `config` + `secrets`):
  `readiness:query:status` returns `{ missingConfig, missingSecrets, ready }`
  for the calling tenant — the settings-checklist call for admin UIs.
  `config:query:readiness` deliberately refused a `ready` verdict (it can't
  see secrets); this feature sees both, so it may verdict.
- `collectMissingRequiredConfig` exported from the config barrel — the same
  cascade + access filter `config:query:readiness` uses, reusable.
- **Behavioral change (intended):** a missing required secret at build time
  (SMTP password, S3 secret-access-key) now throws `UnconfiguredError`
  (422, code `unconfigured`) instead of a bare `Error` (500) — the use-time
  mirror of the config-key change in #272. New `requireSecretSet` helper in
  `foundation-shared`. Pinned end-to-end in the mail-foundation and
  file-foundation integration tests.

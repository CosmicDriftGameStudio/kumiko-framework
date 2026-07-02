---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Unified encryption: encrypted config keys and encrypted entity fields now use
the same versioned envelope mechanism as `ctx.secrets` (DEK per value, KEK from
`KUMIKO_SECRETS_MASTER_KEY_V<n>`), making key rotation possible everywhere.

- New `createEnvelopeCipher` (framework/secrets): JSON `StoredEnvelope` in TEXT
  columns, format detection, decrypt-only legacy fallback, shared DEK cache.
  `MasterKeyProvider.wrapDek/unwrapDek` gained an optional `KeyScope` param
  (BYOK hook; env provider ignores it).
- Config: `ConfigResolverOptions.encryption` → `cipher` (EnvelopeCipher);
  reading an encrypted key without a cipher now THROWS instead of silently
  returning the ciphertext as the value. New manual `config:reencrypt` job
  migrates legacy `CONFIG_ENCRYPTION_KEY` rows and rotates old kekVersions.
- Entity fields: `ENCRYPTION_KEY` singleton replaced by boot-injected cipher
  (`configureEntityFieldEncryption`); executor encrypt/decrypt paths are async;
  boot validation now probes keyring availability (malformed keys fail at
  boot). GDPR export decrypts encrypted fields (or emits an explicit
  `[encrypted:unavailable]` marker) instead of leaking ciphertext.
- run{Prod,Dev}App auto-wire the cipher + `masterKeyProvider` from the
  environment; `CONFIG_ENCRYPTION_KEY` / `ENCRYPTION_KEY` remain supported as
  decrypt-only fallbacks until the reencrypt job has run.
- `createEncryptionProvider` is deprecated (legacy decrypt-only). Tests:
  `createTestEnvelopeCipher` / `createTestMasterKeyProvider` in
  framework/testing.

Migration: provision `KUMIKO_SECRETS_MASTER_KEY_V1`, deploy, run
`config:reencrypt`, verify `failed: 0`, then drop the legacy env keys.

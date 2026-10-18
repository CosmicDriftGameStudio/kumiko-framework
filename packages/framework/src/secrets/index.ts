export { createDekCache, type DekCache, type DekCacheOptions, withDekCache } from "./dek-cache.ts";
export { derivePurposeSecret } from "./derive-purpose-secret.ts";
export {
  createEnvMasterKeyProvider,
  type EnvMasterKeyProviderOptions,
  type Keyring,
} from "./env-master-key-provider.ts";
export { decryptValue, encryptValue } from "./envelope.ts";
export {
  createEnvelopeCipher,
  type EnvelopeCipher,
  type EnvelopeCipherOptions,
} from "./envelope-cipher.ts";
export { assertNoSecretLeak } from "./leak-guard.ts";
export { rewrapDek } from "./rotation.ts";
export {
  decodeStoredEnvelope,
  encodeStoredEnvelope,
  isStoredEnvelope,
  type StoredEnvelope,
} from "./stored-envelope.ts";
export {
  type ContainsSecret,
  createSecret,
  type Envelope,
  isSecret,
  type KeyScope,
  type MasterKeyProvider,
  type Secret,
  type SecretAuditContext,
  type SecretKeyRef,
  type SecretsContext,
} from "./types.ts";

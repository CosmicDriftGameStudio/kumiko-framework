export { createDekCache, type DekCache, type DekCacheOptions, withDekCache } from "./dek-cache.js";
export { derivePurposeSecret } from "./derive-purpose-secret.js";
export {
  createEnvMasterKeyProvider,
  type EnvMasterKeyProviderOptions,
  type Keyring,
} from "./env-master-key-provider.js";
export { decryptValue, encryptValue } from "./envelope.js";
export {
  createEnvelopeCipher,
  type EnvelopeCipher,
  type EnvelopeCipherOptions,
} from "./envelope-cipher.js";
export { assertNoSecretLeak } from "./leak-guard.js";
export { rewrapDek } from "./rotation.js";
export {
  decodeStoredEnvelope,
  encodeStoredEnvelope,
  isStoredEnvelope,
  type StoredEnvelope,
} from "./stored-envelope.js";
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
} from "./types.js";

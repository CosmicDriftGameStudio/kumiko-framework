export { createDekCache, type DekCache, type DekCacheOptions, withDekCache } from "./dek-cache";
export {
  createEnvMasterKeyProvider,
  type EnvMasterKeyProviderOptions,
  type Keyring,
} from "./env-master-key-provider";
export { decryptValue, encryptValue } from "./envelope";
export {
  createEnvelopeCipher,
  type EnvelopeCipher,
  type EnvelopeCipherOptions,
} from "./envelope-cipher";
export {
  decodeStoredEnvelope,
  encodeStoredEnvelope,
  isStoredEnvelope,
  type StoredEnvelope,
} from "./stored-envelope";
export { assertNoSecretLeak } from "./leak-guard";
export { rewrapDek } from "./rotation";
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
} from "./types";

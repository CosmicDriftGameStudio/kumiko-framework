export { createDekCache, type DekCache, withDekCache } from "./dek-cache.ts";
export { derivePurposeSecret } from "./derive-purpose-secret.ts";
export { createEnvMasterKeyProvider } from "./env-master-key-provider.ts";
export { decryptValue, encryptValue } from "./envelope.ts";
export {
  createEnvelopeCipher,
  type EnvelopeCipher,
  type EnvelopeCipherOptions,
} from "./envelope-cipher.ts";
export { rewrapDek } from "./rotation.ts";
export {
  decodeStoredEnvelope,
  encodeStoredEnvelope,
  isStoredEnvelope,
  type StoredEnvelope,
} from "./stored-envelope.ts";
export {
  createSecret,
  type MasterKeyProvider,
  type Secret,
  type SecretsContext,
} from "./types.ts";

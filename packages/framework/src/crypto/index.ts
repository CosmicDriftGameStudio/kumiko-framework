export {
  collectLookupableFields,
  computeBlindIndex,
  configureBlindIndexKey,
  configuredBlindIndexKey,
  decodeBlindIndexKey,
} from "./blind-index.ts";
export { configuredEventPiiCatalog } from "./event-pii.ts";
export { InMemoryKmsAdapter } from "./in-memory-kms-adapter.ts";
export { isSelfPiiField } from "./is-self-pii-field.ts";
export { resolvePlatformKeks } from "./kek-source.ts";
export {
  KeyAlreadyExistsError,
  KeyErasedError,
  type KmsAdapter,
  type KmsContext,
  type LocalKeyKmsAdapter,
  type SubjectId,
  subjectIdSchema,
  subjectIdToKey,
  subjectKeyForRecord,
  subjectKeyForUser,
} from "./kms-adapter.ts";
export { ENCRYPTION_UNAVAILABLE_CODE, EncryptionUnavailableError } from "./kms-outage.ts";
export {
  type KmsWiring,
  requireKmsWiring,
  requireKmsWiringAsync,
  resolveKmsWiring,
  resolveKmsWiringAsync,
} from "./kms-wiring.ts";
export {
  hashOpaqueToken,
  hashOpaqueTokenSync,
  opaqueTokenHashMatches,
} from "./opaque-token-hash.ts";
export {
  createPgKmsAdapter,
  rewrapSubjectKeys,
} from "./pg-kms-adapter.ts";
export {
  PII_CIPHERTEXT_CORRUPT_CODE,
  PiiCiphertextCorruptError,
} from "./pii-ciphertext-corrupt.ts";
export {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  decryptPiiValueForSubject,
  encryptPiiFieldValues,
  encryptPiiJsonValueForSubject,
  encryptPiiValueForSubject,
  isPiiCiphertext,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "./pii-field-encryption.ts";
export {
  collectPiiEncryptedFields,
  collectPiiSubjectFields,
  isRecordKeyedField,
  resolveSubjectForField,
  SubjectResolutionError,
} from "./subject-resolver.ts";

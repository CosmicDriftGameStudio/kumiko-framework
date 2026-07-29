// Test assertions and domain test fixtures. Production code (dev-server, bin/)
// must import nothing from this subpath — the stack builders live in
// `@cosmicdrift/kumiko-framework/stack`.

// The four cache/injection resets stay in their own modules (they close over
// module-private state) and are only re-exported here — they are out of /crypto
// and /db as of #1631. A production call to resetPiiSubjectKmsForTests() silently
// switches the PII layer off, and subject-annotated fields are written in
// plaintext from then on: no error, no log.
export { resetBlindIndexKeyForTests } from "../crypto/blind-index";
export { resetEventPiiCatalogForTests } from "../crypto/event-pii";
export { resetPiiSubjectKmsForTests } from "../crypto/pii-field-encryption";
export { resetEntityFieldEncryptionCacheForTests } from "../db/entity-field-encryption";

export { rolesOf } from "./access-assertions";
export { expectError, expectSuccess } from "./assertions";
export { withBootValidatorFixture } from "./boot-validator-fixture";
export { type ClearableTable, clearTables, resetTestTables } from "./db-cleanup";
export {
  type E2EGeneratorOptions,
  type E2ETestSpec,
  type EditFillOp,
  generateE2ESpec,
  generateZodFixture,
} from "./e2e-generator";
export { expectErrorIncludes } from "./expect-error";
export { describeFileProviderContract } from "./file-provider-contract";
export { bridgeStub } from "./handler-context";
export {
  getSetCookieRaw,
  getSetCookies,
  getSetCookieValue,
  type ParsedSetCookie,
} from "./http-cookies";
export { createLateBoundHolder, type LateBoundHolder } from "./late-bound";
export { buildMultipartBody, patchFileInstanceofForBunTest } from "./multipart-helper";
export {
  createMutableMasterKeyProvider,
  createTestEnvelopeCipher,
  createTestMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "./mutable-master-key-provider";
export {
  createRecordingProvider,
  type RecordingProvider,
} from "./observability-recorder";
export { deleteRows, seedRow, seedRows, updateRows } from "./seed";
export {
  sharedItemEntity,
  sharedItemTable,
  sharedUserEntity,
  sharedUserTable,
  sharedWidgetEntity,
  sharedWidgetTable,
} from "./shared-entities";
export { sleep } from "./utils";
export { waitFor } from "./wait-for";
export { withoutAmbientTemporal } from "./without-ambient-temporal";

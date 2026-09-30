// Test assertions and domain test fixtures. Production code (dev-server, bin/)
// must import nothing from this subpath — the stack builders live in
// `@cosmicdrift/kumiko-framework/stack`.

// The four cache/injection resets stay in their own modules (they close over
// module-private state) and are only re-exported here — they are out of /crypto
// and /db as of #1631. A production call to resetPiiSubjectKmsForTests() silently
// switches the PII layer off, and subject-annotated fields are written in
// plaintext from then on: no error, no log.
export { resetBlindIndexKeyForTests } from "../crypto/blind-index.js";
export { resetEventPiiCatalogForTests } from "../crypto/event-pii.js";
export { resetPiiSubjectKmsForTests } from "../crypto/pii-field-encryption.js";
export { resetEntityFieldEncryptionCacheForTests } from "../db/entity-field-encryption.js";

export { rolesOf } from "./access-assertions.js";
export { expectError, expectSuccess } from "./assertions.js";
export { withBootValidatorFixture } from "./boot-validator-fixture.js";
export { captureClosedConnectionError } from "./closed-connection-error.js";
export { type ClearableTable, clearTables, resetTestTables } from "./db-cleanup.js";
export {
  type E2EGeneratorOptions,
  type E2ETestSpec,
  type EditFillOp,
  generateE2ESpec,
  generateZodFixture,
} from "./e2e-generator.js";
export { expectErrorIncludes } from "./expect-error.js";
export { describeFileProviderContract } from "./file-provider-contract.js";
export { bridgeStub } from "./handler-context.js";
export {
  getSetCookieRaw,
  getSetCookies,
  getSetCookieValue,
  type ParsedSetCookie,
} from "./http-cookies.js";
export { createLateBoundHolder, type LateBoundHolder } from "./late-bound.js";
export { buildMultipartBody, patchFileInstanceofForBunTest } from "./multipart-helper.js";
export {
  createMutableMasterKeyProvider,
  createTestEnvelopeCipher,
  createTestMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "./mutable-master-key-provider.js";
export {
  createRecordingProvider,
  type RecordingProvider,
} from "./observability-recorder.js";
export { isRealProviderRun, REAL_PROVIDERS_ENV, requireRealProviders } from "./real-providers.js";
export { deleteRows, seedRow, seedRows, updateRows } from "./seed.js";
export {
  sharedItemEntity,
  sharedItemTable,
  sharedUserEntity,
  sharedUserTable,
  sharedWidgetEntity,
  sharedWidgetTable,
} from "./shared-entities.js";
export { sleep } from "./utils.js";
export { waitFor } from "./wait-for.js";
export { withoutAmbientTemporal } from "./without-ambient-temporal.js";

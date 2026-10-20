// Test assertions and domain test fixtures. Production code (dev-server, bin/)
// must import nothing from this subpath — the stack builders live in
// `@cosmicdrift/kumiko-testing/stack`.

// The four cache/injection resets stay in their own modules (they close over
// module-private state) and are only re-exported here — they are out of /crypto
// and /db as of #1631. A production call to resetPiiSubjectKmsForTests() silently
// switches the PII layer off, and subject-annotated fields are written in
// plaintext from then on: no error, no log.
export {
  resetBlindIndexKeyForTests,
  resetEntityFieldEncryptionCacheForTests,
  resetEventPiiCatalogForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/internal/testing";
export { rolesOf } from "./access-assertions.ts";
export { expectError, expectSuccess } from "./assertions.ts";
export { type Barrier, createBarrier } from "./barrier.ts";
export { withBootValidatorFixture } from "./boot-validator-fixture.ts";
export { type BurstResult, burst } from "./burst.ts";
export {
  captureClosedConnectionError,
  terminateBackendsByApplicationName,
  testDatabaseUrl,
} from "./closed-connection-error.ts";
export { type ClearableTable, clearTables, resetTestTables } from "./db-cleanup.ts";
export {
  type E2EGeneratorOptions,
  type E2ETestSpec,
  type EditFillOp,
  generateE2ESpec,
  generateZodFixture,
} from "./e2e-generator.ts";
export { expectErrorIncludes } from "./expect-error.ts";
export { describeFileProviderContract } from "./file-provider-contract.ts";
export {
  getSetCookieRaw,
  getSetCookies,
  getSetCookieValue,
  type ParsedSetCookie,
} from "./http-cookies.ts";
export { createLateBoundHolder, type LateBoundHolder } from "./late-bound.ts";
export { createManualClock, type ManualClock } from "./manual-clock.ts";
export { buildMultipartBody, patchFileInstanceofForBunTest } from "./multipart-helper.ts";
export {
  createMutableMasterKeyProvider,
  createTestEnvelopeCipher,
  createTestMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "./mutable-master-key-provider.ts";
export {
  createRecordingProvider,
  type RecordingProvider,
} from "./observability-recorder.ts";
export { isRealProviderRun, REAL_PROVIDERS_ENV, requireRealProviders } from "./real-providers.ts";
export { deleteRows, seedRow, seedRows, updateRows } from "./seed.ts";
export {
  sharedItemEntity,
  sharedItemTable,
  sharedUserEntity,
  sharedUserTable,
  sharedWidgetEntity,
  sharedWidgetTable,
} from "./shared-entities.ts";
export { createTestStoredEvent } from "./stored-event-fixture.ts";
export { sleep } from "./utils.ts";
export { waitFor } from "./wait-for.ts";
export { withoutAmbientTemporal } from "./without-ambient-temporal.ts";
export { zipWithEntries } from "./zip-fixture.ts";

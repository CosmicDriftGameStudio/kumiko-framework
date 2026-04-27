// Test-Assertions, Domain-Test-Fixtures und Vitest-spezifische Helpers.
// Production-Code (dev-server, bin/) darf NICHTS aus diesem Sub-Path importieren —
// die Stack-Builder leben in `@kumiko/framework/stack`, dieses Modul darf
// vitest-Imports top-level enthalten (siehe expect-error.ts).

export { rolesOf } from "./access-assertions";
export { expectError, expectSuccess } from "./assertions";
export {
  type E2EGeneratorOptions,
  type E2ETestSpec,
  type EditFillOp,
  generateE2ESpec,
  generateZodFixture,
} from "./e2e-generator";
export { expectErrorIncludes } from "./expect-error";
export { bridgeStub } from "./handler-context";
export {
  getSetCookieRaw,
  getSetCookies,
  getSetCookieValue,
  type ParsedSetCookie,
} from "./http-cookies";
export { createLateBoundHolder, type LateBoundHolder } from "./late-bound";
export {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "./mutable-master-key-provider";
export {
  createRecordingProvider,
  type RecordingProvider,
} from "./observability-recorder";
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

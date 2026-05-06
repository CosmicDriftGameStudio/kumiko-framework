// Runtime-safe Stack-Builder. Was hier liegt, wird vom dev-server zum Hochfahren
// einer kompletten Kumiko-Instanz genutzt — DB, Redis, Hono-App, Dispatcher,
// SSE-Broker. Die Files heißen historisch `test*` (createTestDb,
// setupTestStack, TestUsers, …), bedienen aber heute Dev- UND Test-Code: das
// ist genau derselbe Hochfahr-Pfad, nur einmal mit ephemeral-DB (test) und
// einmal mit persistent-DB (dev).
//
// Wichtig: dieses Modul darf KEINE vitest-Imports enthalten und keine
// Vitest-only Helper transitiv ziehen — sonst crasht jedes Tooling, das den
// dev-server unter Node lädt (drizzle-kit, build-scripts).

export {
  type CreateTestDbOptions,
  createTestDb,
  type TestDb,
} from "./db";
export { createEventCollector, type EventCollector } from "./event-collector";
export { pushEntityProjectionTables } from "./push-entity-projection-tables";
export { createTestRedis, type TestRedis } from "./redis";
export { createRequestHelper, type RequestHelper } from "./request-helper";
export {
  resetEventStore,
  unsafeCreateEntityTable,
  unsafeEnsureEntityTable,
  unsafePushTables,
} from "./table-helpers";
export { setupTestStack, type TestStack, type TestStackOptions } from "./test-stack";
export {
  createTestUser,
  TestUsers,
  testTenantId,
  testUserId,
} from "./test-users";

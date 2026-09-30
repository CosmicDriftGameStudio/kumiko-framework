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
} from "./db.js";
export { drainEventConsumers } from "./drain-event-consumers.js";
export { createEventCollector, type EventCollector } from "./event-collector.js";
export { pushEntityProjectionTables } from "./push-entity-projection-tables.js";
export { createTestRedis, type TestRedis } from "./redis.js";
export { createRequestHelper, type RequestHelper } from "./request-helper.js";
export {
  resetEventStore,
  unsafeCreateEntityTable,
  unsafeEnsureEntityTable,
  unsafePushTables,
} from "./table-helpers.js";
export { setupTestStack, type TestStack, type TestStackOptions } from "./test-stack.js";
export {
  createTestUser,
  TestUsers,
  testTenantId,
  testUserId,
} from "./test-users.js";

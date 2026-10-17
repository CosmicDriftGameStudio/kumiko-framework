// @runtime dev
// Runtime-safe stack builder. The dev-server uses what lives here to boot a
// complete Kumiko instance: DB, Redis, Hono app, dispatcher, SSE broker. The
// files are historically named `test*` (createTestDb, setupTestStack,
// TestUsers, …) but serve dev AND test code today: it is the same boot path,
// once with an ephemeral DB (test) and once with a persistent DB (dev).
//
// Important: this module must contain NO vitest imports and must not pull
// vitest-only helpers in transitively, or every tool that loads the dev-server
// under Node (drizzle-kit, build scripts) crashes.

export {
  unsafeCreateEntityTable,
  unsafeEnsureEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
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
export { resetEventStore } from "./table-helpers.js";
export { setupTestStack, type TestStack, type TestStackOptions } from "./test-stack.js";

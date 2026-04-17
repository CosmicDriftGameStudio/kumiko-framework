import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../api/auth-routes";
import type { JwtHelper } from "../api/jwt";
import { buildServer } from "../api/server";
import { createSseBroker } from "../api/sse-broker";
import { createRegistry } from "../engine/registry";
import type { FeatureDefinition, Registry, TenantId } from "../engine/types";
import { createEventsTable } from "../event-store";
import type { ObservabilityProvider } from "../observability";
import type { EventBroker, EventDispatcher, OutboxPoller } from "../pipeline";
import {
  createEntityCache,
  createEventBroker,
  createEventDedup,
  createEventLog,
  createIdempotencyGuard,
  EVENT_OUTBOX_PARTIAL_INDEX_SQL,
  eventOutboxTable,
} from "../pipeline";
import type { SystemHooks } from "../pipeline/lifecycle-pipeline";
import { createSearchHooks, createSseBroadcastEventConsumer } from "../pipeline/system-hooks";
import { createInMemorySearchAdapter } from "../search";
import type { SearchAdapter } from "../search/types";
import { createEventCollector, type EventCollector } from "./event-collector";
import { createTestDb, createTestRedis, pushTables, type TestDb, type TestRedis } from "./index";
import { createRequestHelper, type RequestHelper } from "./request-helper";

export type TestStack = {
  app: Hono;
  jwt: JwtHelper;
  registry: Registry;
  db: TestDb;
  redis: TestRedis;
  search: SearchAdapter;
  events: EventCollector;
  http: RequestHelper;
  observability: ObservabilityProvider;
  // Present only when options.outbox === true. Tests call outboxPoller.runOnce()
  // to drain the outbox deterministically instead of waiting on the timer.
  outboxPoller?: OutboxPoller;
  eventBroker?: EventBroker;
  // Present only when any feature registered an r.postEvent() subscriber.
  // Tests drain it via eventDispatcher.runOnce() for deterministic assertion.
  eventDispatcher?: EventDispatcher;
  cleanup: () => Promise<void>;
};

export type TestStackOptions = {
  features: readonly FeatureDefinition[];
  /** System hooks to wire up. Default: all (sse, search) */
  systemHooks?: ("sse" | "search")[];
  /** Search config per tenant — defaults to tenant 1 with all text fields */
  searchConfig?: {
    tenantId: TenantId;
    searchableFields: string[];
    rankingFields: string[];
  };
  jwtSecret?: string;
  /** Extra fields merged into the AppContext (e.g. _notifyFactory, configResolver).
   *  Can be a function receiving (registry, db, sseBroker) for late binding. */
  extraContext?:
    | Record<string, unknown>
    | ((deps: {
        registry: Registry;
        db: import("../db/connection").DbConnection;
        sseBroker: import("../api/sse-broker").SseBroker;
        redis: import("ioredis").default;
      }) => Record<string, unknown>);
  /** Wire up auth routes (login, tenant-switch). Leave undefined to skip. */
  authConfig?: AuthRoutesConfig;
  /** Wire up the transactional outbox (ctx.emit + poller). Default: false.
   *  Pass an object to hook into dead-letter events (e.g. for alerting tests). */
  outbox?:
    | boolean
    | {
        onDeadLetter?: (
          event: import("../pipeline/outbox-poller").DeadLetterEvent,
        ) => void | Promise<void>;
      };
  /** Observability provider — omit for NoopProvider (no spans/metrics).
   *  Pass a ConsoleProvider to see the span tree in stdout, or a custom
   *  provider (e.g. a recording provider for assertions in tests). */
  observability?: ObservabilityProvider;
};

const DEFAULT_JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

export async function setupTestStack(options: TestStackOptions): Promise<TestStack> {
  const jwtSecret = options.jwtSecret ?? DEFAULT_JWT_SECRET;
  const enabledHooks = options.systemHooks ?? ["sse", "search"];

  const [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);

  // Every ES-entity writes events, and r.crud() generates event-store-executor-
  // backed handlers. Auto-create the events table so every setupTestStack call
  // is ready for writes without needing a manual createEventsTable().
  await createEventsTable(testDb.db);

  // Framework state for projection rebuild/status + event-consumer cursors.
  // Idempotent — production boot flows run the same calls.
  const { createProjectionStateTable, createEventConsumerStateTable } = await import("../pipeline");
  await createProjectionStateTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);

  // Projection tables: the executor writes into them in the same TX as the
  // event-append, so they have to exist before the first write. Auto-push
  // everything registered via r.projection() — keeps tests from having to
  // know which projections a feature happens to declare. Two projections
  // backed by the same physical table (e.g. an alternative apply-shape for
  // the same read-model in a test feature) are deduped by Drizzle-table
  // reference so drizzle-kit doesn't emit duplicate CREATE TABLE statements.
  const projectionTables: Record<string, unknown> = {};
  const seenTables = new Set<unknown>();
  for (const feature of options.features) {
    for (const [projName, proj] of Object.entries(feature.projections)) {
      if (seenTables.has(proj.table)) continue;
      seenTables.add(proj.table);
      projectionTables[projName] = proj.table;
    }
  }
  if (Object.keys(projectionTables).length > 0) {
    await pushTables(testDb.db, projectionTables);
  }

  const searchAdapter = createInMemorySearchAdapter();
  const events = createEventCollector();
  const registry = createRegistry([...options.features]);

  // Auto-configure search for tenant 1 based on registry
  if (enabledHooks.includes("search")) {
    const searchableFields: string[] = [];
    for (const feature of options.features) {
      for (const [, entity] of Object.entries(feature.entities)) {
        for (const [fieldName, field] of Object.entries(entity.fields)) {
          if (field.type === "text" && field.searchable) {
            searchableFields.push(fieldName);
          }
          if (field.type === "embedded") {
            for (const [subName, subField] of Object.entries(field.schema)) {
              if (subField.searchable) {
                searchableFields.push(`${fieldName}_${subName}`);
              }
            }
          }
        }
      }
    }

    if (options.searchConfig) {
      await searchAdapter.configure(options.searchConfig.tenantId, {
        searchableFields: options.searchConfig.searchableFields,
        rankingFields: options.searchConfig.rankingFields,
      });
    } else if (searchableFields.length > 0) {
      await searchAdapter.configure("00000000-0000-4000-8000-000000000001", {
        searchableFields,
        rankingFields: searchableFields,
      });
    }
  }

  // Wire SSE broker with event collector
  const sseBroker = createSseBroker();
  sseBroker.addClient(
    "tenant:00000000-0000-4000-8000-000000000001",
    (event) => events.sse.push(event),
    () => {},
  );

  // Build system hooks based on selection. The search helper auto-picks the
  // batch variant when the adapter exposes indexBatch/removeBatch — no
  // consumer change needed when swapping adapters.
  //
  // SSE lives in the async event-dispatcher since D.3, not as a postSave/
  // postDelete hook — see the `systemConsumers` wiring further down.
  const searchHooks = enabledHooks.includes("search")
    ? createSearchHooks(searchAdapter, registry)
    : {};
  const systemHooks: SystemHooks = {
    ...(searchHooks.postSave ? { postSave: searchHooks.postSave } : {}),
    ...(searchHooks.postSaveBatch ? { postSaveBatch: searchHooks.postSaveBatch } : {}),
    ...(searchHooks.postDelete ? { postDelete: searchHooks.postDelete } : {}),
    ...(searchHooks.postDeleteBatch ? { postDeleteBatch: searchHooks.postDeleteBatch } : {}),
  };

  const eventLog = createEventLog(testRedis.redis, "kumiko:test:stack-log");
  const idempotency = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(testRedis.redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(testRedis.redis, { ttlSeconds: 60 });

  // Outbox wiring — off by default, tests that exercise ctx.emit flip it on.
  // The table + index is created up-front; the actual Poller lifecycle
  // (instantiate, start, stop) is delegated to buildServer so tests run
  // against the production path, not a test-only side channel.
  let eventBroker: EventBroker | undefined;
  let subscriberRedis: import("ioredis").default | undefined;
  if (options.outbox) {
    await pushTables(testDb.db, { eventOutbox: eventOutboxTable });
    await testDb.db.execute(EVENT_OUTBOX_PARTIAL_INDEX_SQL);

    subscriberRedis = testRedis.redis.duplicate();
    // Broker's start() intentionally NOT called — delivery runs through
    // dispatchLocal (synchronous) via the outbox poller. Redis pub/sub is
    // only needed when a *different* process should receive events, which
    // tests don't exercise.
    eventBroker = createEventBroker(testRedis.redis, testRedis.redis.duplicate());
  }

  const server = buildServer({
    registry,
    context: {
      db: testDb.db,
      redis: testRedis.redis,
      searchAdapter,
      entityCache,
      registry,
      ...(typeof options.extraContext === "function"
        ? options.extraContext({ registry, db: testDb.db, sseBroker, redis: testRedis.redis })
        : options.extraContext),
    },
    jwtSecret,
    dispatcherOptions: { eventLog, idempotency },
    systemHooks,
    eventDedup,
    sseBroker,
    // Default tests to no login rate-limiter so existing suites that loop
    // over logins don't hit a 429 after 10 attempts. Suites specifically
    // testing the limiter can override via authConfig.loginRateLimit.
    ...(options.authConfig
      ? {
          auth: {
            ...options.authConfig,
            ...(options.authConfig.loginRateLimit === undefined ? { loginRateLimit: null } : {}),
          },
        }
      : {}),
    ...(options.outbox && subscriberRedis && eventBroker
      ? {
          outbox: {
            redis: testRedis.redis,
            subscriberRedis,
            eventBroker,
            pollIntervalMs: 50,
            batchSize: 200,
            maxAttempts: 3,
            ...(typeof options.outbox === "object" && options.outbox.onDeadLetter
              ? { onDeadLetter: options.outbox.onDeadLetter }
              : {}),
          },
        }
      : {}),
    ...(options.observability ? { observability: options.observability } : {}),
  });

  // Poller comes from buildServer — same instance a production caller gets.
  // Tests invoke runOnce() for determinism; the wake-up/timer paths have
  // dedicated tests that call start()/stop().
  const outboxPoller = server.outboxPoller;

  // Build the async event-dispatcher. Consumers come from two sources:
  //   1. Features via r.postEvent() — user-space subscribers
  //   2. System-level via `enabledHooks` — SSE broadcast since D.3
  //
  // Tests drive the dispatcher via stack.eventDispatcher.runOnce() for
  // deterministic drains — no timer-induced flakiness. When no consumer is
  // wired, stay undefined so cleanup stays cheap.
  const featureSubscribers = [...registry.getAllPostEventSubscribers().values()].map((s) => ({
    name: s.name,
    handler: s.handler,
  }));
  const systemConsumers = enabledHooks.includes("sse")
    ? [createSseBroadcastEventConsumer(sseBroker)]
    : [];
  const allConsumers = [...featureSubscribers, ...systemConsumers];
  const { createEventDispatcher } = await import("../pipeline");
  const eventDispatcher =
    allConsumers.length > 0
      ? createEventDispatcher({
          db: testDb.db,
          consumers: allConsumers,
          // AppContext minimum: registry + db. Hooks pulled in via context
          // spread reach AppContext the same way other stack-level hooks do.
          context: { db: testDb.db, redis: testRedis.redis, registry },
          // Fast timer for tests; production boot can override.
          pollIntervalMs: 50,
        })
      : undefined;

  const http = createRequestHelper(server.app, server.jwt);

  return {
    app: server.app,
    jwt: server.jwt,
    registry,
    db: testDb,
    redis: testRedis,
    search: searchAdapter,
    events,
    http,
    observability: server.observability,
    ...(outboxPoller ? { outboxPoller } : {}),
    ...(eventBroker ? { eventBroker } : {}),
    ...(eventDispatcher ? { eventDispatcher } : {}),
    cleanup: async () => {
      if (outboxPoller) await outboxPoller.stop();
      if (eventDispatcher) await eventDispatcher.stop();
      if (eventBroker) await eventBroker.stop();
      if (subscriberRedis) subscriberRedis.disconnect();
      await server.observability.shutdown();
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

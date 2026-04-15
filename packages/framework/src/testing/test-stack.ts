import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../api/auth-routes";
import type { JwtHelper } from "../api/jwt";
import { buildServer } from "../api/server";
import { createSseBroker } from "../api/sse-broker";
import { createRegistry } from "../engine/registry";
import type { FeatureDefinition, Registry } from "../engine/types";
import type { EventBroker, OutboxPoller } from "../pipeline";
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
import {
  createAuditTrailDeleteHook,
  createAuditTrailHook,
  createSearchIndexHook,
  createSseBroadcastHook,
  createSseDeleteBroadcastHook,
} from "../pipeline/system-hooks";
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
  // Present only when options.outbox === true. Tests call outboxPoller.runOnce()
  // to drain the outbox deterministically instead of waiting on the timer.
  outboxPoller?: OutboxPoller;
  eventBroker?: EventBroker;
  cleanup: () => Promise<void>;
};

export type TestStackOptions = {
  features: readonly FeatureDefinition[];
  /** System hooks to wire up. Default: all (audit, sse, search) */
  systemHooks?: ("audit" | "sse" | "search")[];
  /** Search config per tenant — defaults to tenant 1 with all text fields */
  searchConfig?: {
    tenantId: number;
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
};

const DEFAULT_JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

export async function setupTestStack(options: TestStackOptions): Promise<TestStack> {
  const jwtSecret = options.jwtSecret ?? DEFAULT_JWT_SECRET;
  const enabledHooks = options.systemHooks ?? ["audit", "sse", "search"];

  const [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);

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
      await searchAdapter.configure(1, {
        searchableFields,
        rankingFields: searchableFields,
      });
    }
  }

  // Wire SSE broker with event collector
  const sseBroker = createSseBroker();
  sseBroker.addClient(
    "tenant:1",
    (event) => events.sse.push(event),
    () => {},
  );

  // Build system hooks based on selection
  const systemHooks: SystemHooks = {
    postSave: [
      ...(enabledHooks.includes("search") ? [createSearchIndexHook(searchAdapter, registry)] : []),
      ...(enabledHooks.includes("sse") ? [createSseBroadcastHook(sseBroker)] : []),
      ...(enabledHooks.includes("audit") ? [createAuditTrailHook(events.auditStorage)] : []),
    ],
    postDelete: [
      ...(enabledHooks.includes("sse") ? [createSseDeleteBroadcastHook(sseBroker)] : []),
      ...(enabledHooks.includes("audit") ? [createAuditTrailDeleteHook(events.auditStorage)] : []),
    ],
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
  });

  // Poller comes from buildServer — same instance a production caller gets.
  // Tests invoke runOnce() for determinism; the wake-up/timer paths have
  // dedicated tests that call start()/stop().
  const outboxPoller = server.outboxPoller;

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
    ...(outboxPoller ? { outboxPoller } : {}),
    ...(eventBroker ? { eventBroker } : {}),
    cleanup: async () => {
      if (outboxPoller) await outboxPoller.stop();
      if (eventBroker) await eventBroker.stop();
      if (subscriberRedis) subscriberRedis.disconnect();
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

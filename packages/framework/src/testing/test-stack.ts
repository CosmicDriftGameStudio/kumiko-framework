import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../api/auth-routes";
import type { JwtHelper } from "../api/jwt";
import { buildServer } from "../api/server";
import { createSseBroker } from "../api/sse-broker";
import { createRegistry } from "../engine/registry";
import type { FeatureDefinition, Registry, TenantId } from "../engine/types";
import { createArchivedStreamsTable, createEventsTable } from "../event-store";
import type { ObservabilityProvider } from "../observability";
import type { EventDispatcher } from "../pipeline";
import {
  createEntityCache,
  createEventDedup,
  createEventLog,
  createIdempotencyGuard,
} from "../pipeline";
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
  // Present whenever a system consumer (SSE, Search) or
  // r.multiStreamProjection is wired. Tests drain it via runOnce() for
  // deterministic assertion — no timer-induced flakiness.
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
  /** Observability provider — omit for NoopProvider (no spans/metrics).
   *  Pass a ConsoleProvider to see the span tree in stdout, or a custom
   *  provider (e.g. a recording provider for assertions in tests). */
  observability?: ObservabilityProvider;
};

const DEFAULT_JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

export async function setupTestStack(options: TestStackOptions): Promise<TestStack> {
  const jwtSecret = options.jwtSecret ?? DEFAULT_JWT_SECRET;
  const enabledHooks = options.systemHooks ?? ["sse", "search"];

  // Temporal-Polyfill installieren bevor Feature-Code läuft. Idempotent —
  // Production-Server-Boot ruft das gleich. Auf Runtimes mit nativem
  // Temporal ein No-Op.
  const { ensureTemporalPolyfill } = await import("../time/polyfill");
  await ensureTemporalPolyfill();

  const [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);

  // Every ES-entity writes events via createEventStoreExecutor in the
  // feature's write handlers. Auto-create the events table so every
  // setupTestStack call is ready for writes without needing a manual
  // createEventsTable().
  await createEventsTable(testDb.db);
  // Archive-stream metadata — needed by ctx.appendEvent's archive guard and
  // loadAggregate's default-skip. Idempotent, so production boot running
  // the same call is fine.
  await createArchivedStreamsTable(testDb.db);

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
    // Multi-stream projection tables follow the same auto-push rule — the
    // async dispatcher writes to them as soon as the first matching event
    // flows through, so the DDL must exist before setupTestStack returns.
    // skip: MSPs without a table are pure side-effect consumers.
    for (const [mspName, msp] of Object.entries(feature.multiStreamProjections)) {
      if (!msp.table) continue;
      if (seenTables.has(msp.table)) continue;
      seenTables.add(msp.table);
      projectionTables[`msp_${mspName}`] = msp.table;
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

  const eventLog = createEventLog(testRedis.redis, "kumiko:test:stack-log");
  const idempotency = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(testRedis.redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(testRedis.redis, { ttlSeconds: 60 });

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
    eventDedup,
    sseBroker,
    // Tests drive the dispatcher via stack.eventDispatcher.runOnce() for
    // deterministic drains — no timer-induced flakiness. pollIntervalMs
    // stays short anyway in case a test opts into `.start()`. pgClient
    // plumbs through the LISTEN wake-up for tests that want to measure
    // post-commit latency (Sprint E.4).
    eventDispatcher: {
      pollIntervalMs: 50,
      pgClient: testDb.client,
      systemConsumers: {
        sse: enabledHooks.includes("sse"),
        search: enabledHooks.includes("search"),
      },
    },
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
    ...(options.observability ? { observability: options.observability } : {}),
  });

  const eventDispatcher: EventDispatcher | undefined = server.eventDispatcher;

  // Pre-register consumer state rows so tests can call runOnce() directly
  // without a preceding explicit start(). Timer fires at pollIntervalMs=50
  // but passInFlight serialises concurrent passes — tests that drain via
  // runOnce() remain deterministic. Tests that specifically exercise the
  // timer loop call start() again (idempotent) after setup.
  if (eventDispatcher) await eventDispatcher.ensureRegistered();

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
    ...(eventDispatcher ? { eventDispatcher } : {}),
    cleanup: async () => {
      if (eventDispatcher) await eventDispatcher.stop();
      await server.observability.shutdown();
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

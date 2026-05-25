import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../api/auth-routes";
import type { JwtHelper } from "../api/jwt";
import { buildServer } from "../api/server";
import { createSseBroker } from "../api/sse-broker";
import type { PgClient } from "../db/connection";
import { extractTableInfo } from "../db/query";
import { createRegistry } from "../engine/registry";
import type { FeatureDefinition, Registry, TenantId } from "../engine/types";
import { createArchivedStreamsTable, createEventsTable } from "../event-store";
import type { Lifecycle } from "../lifecycle";
import type { ObservabilityProvider } from "../observability";
import type { EventDispatcher } from "../pipeline";
import { createEntityCache, createEventDedup, createIdempotencyGuard } from "../pipeline";
import { createInMemorySearchAdapter } from "../search";
import type { SearchAdapter } from "../search/types";
import { createTestDb } from "./db";
import { createEventCollector, type EventCollector } from "./event-collector";
import { createTestRedis, type TestRedis } from "./redis";
import { createRequestHelper, type RequestHelper } from "./request-helper";
import { unsafePushTables } from "./table-helpers";

export type TestStack = {
  app: Hono;
  jwt: JwtHelper;
  registry: Registry;
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider connection
  db: any;
  redis: TestRedis;
  search: SearchAdapter;
  events: EventCollector;
  http: RequestHelper;
  observability: ObservabilityProvider;
  // Present whenever a system consumer (SSE, Search) or
  // r.multiStreamProjection is wired. Tests drain it via runOnce() for
  // deterministic assertion — no timer-induced flakiness.
  eventDispatcher?: EventDispatcher;
  // Only set when the caller passed `lifecycle` via options. Tests that
  // exercise drain() / /health/ready wire one in; ordinary suites ignore it.
  lifecycle?: Lifecycle;
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
        // biome-ignore lint/suspicious/noExplicitAny: cross-provider connection
        db: any;
        sseBroker: import("../api/sse-broker").SseBroker;
        redis: import("ioredis").default;
      }) => Record<string, unknown>);
  /** Wire up auth routes (login, tenant-switch). Leave undefined to skip. */
  authConfig?: AuthRoutesConfig;
  /** Register a file storage provider so uploads via POST /api/files work and
   *  `ctx.files.ref(key)` is available to hooks/MSPs. Omit to skip — tests
   *  without file handling don't need it. */
  files?: { storageProvider: import("../files").FileStorageProvider };
  /** Observability provider — omit for NoopProvider (no spans/metrics).
   *  Pass a ConsoleProvider to see the span tree in stdout, or a custom
   *  provider (e.g. a recording provider for assertions in tests). */
  observability?: ObservabilityProvider;
  /** Inject a process lifecycle so tests can drain() and observe
   *  /health/ready flipping to 503. Omit if the suite doesn't care. */
  lifecycle?: Lifecycle;
  /** Wire L1 (global-IP) and/or L2 (auth-endpoint) rate-limit middleware.
   *  The resolver is auto-built from the test Redis. Mirrors
   *  buildServer's `rateLimit` option 1:1 — see there for shape. */
  rateLimit?: import("../api/server").ServerOptions["rateLimit"];
  /** Inject a MasterKeyProvider for secrets-backed tests. Lands typed in
   *  AppContext — set/delete/get + rotation job pick it up. Omit for
   *  suites that don't touch secrets. */
  masterKeyProvider?: import("../secrets").MasterKeyProvider;
  /** Feature-toggle resolver. When present the dispatcher's feature-gate,
   *  hook-filter, and MSP-filter all consult it; absent = every feature
   *  treated as always-on. Pass the callback from
   *  GlobalFeatureToggleRuntime.effectiveFeatures for real DB-backed
   *  toggles, or a plain `() => new Set<string>(registry.features.keys())`
   *  to force a specific snapshot in a unit-style setup. */
  effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  /** Pin the underlying Postgres DB name instead of the default
   *  `kumiko_test_<8chars>`. Forwarded to createTestDb. Primary use
   *  case: dev servers that want persistent storage across restarts —
   *  combine with `persistentDb: true`. */
  dbName?: string;
  /** When true, cleanup() keeps the Postgres DB around — the caller
   *  owns its lifecycle. Default false (test contract). Used by
   *  dev-server wiring to survive hot-reloads. */
  persistentDb?: boolean;
  /** Forwarded to buildServer — when set, requests without a JWT pass
   *  through as anonymous instead of 401. See AnonymousAccessConfig.
   *  Akzeptiert entweder einen statischen Config-Object ODER eine Factory
   *  `({registry, db, sseBroker, redis}) => Config` — gleiches Pattern wie
   *  `extraContext`. Die Factory wird einmal beim Boot aufgerufen, der
   *  TenantResolver darin closure'd typischerweise `db` für Subdomain-
   *  Lookups. */
  anonymousAccess?:
    | import("../api/server").ServerOptions["anonymousAccess"]
    | ((deps: {
        registry: Registry;
        // biome-ignore lint/suspicious/noExplicitAny: cross-provider connection
        db: any;
        sseBroker: import("../api/sse-broker").SseBroker;
        redis: import("ioredis").default;
      }) => import("../api/server").ServerOptions["anonymousAccess"]);
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

  // Forward db-name/persistent-flag through to createTestDb. The
  // defaults (undefined dbName, persistent:false) keep the legacy
  // test contract: fresh kumiko_test_<random> DB per setup, dropped
  // on cleanup.
  const [testDb, testRedis] = await Promise.all([
    createTestDb({
      ...(options.dbName !== undefined && { dbName: options.dbName }),
      ...(options.persistentDb !== undefined && { persistent: options.persistentDb }),
    }),
    createTestRedis(),
  ]);

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

  // Files support: when a provider is registered, the fileRefs table must
  // exist before the first upload. Skipped when no provider — the table
  // stays off tenant test DBs that never touch files.
  if (options.files) {
    const { fileRefsTable } = await import("../files");
    await unsafePushTables(testDb.db, { fileRefsTable });
  }

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
    // Raw tables declared via r.rawTable(). Same auto-push rule — the
    // table needs to exist before the first reader query runs. The
    // bypass is in the registration site (r.rawTable's `unsafe` cousins
    // would target the same DDL), not in setting up the test DB.
    for (const [rawName, raw] of Object.entries(feature.rawTables)) {
      if (seenTables.has(raw.table)) continue;
      seenTables.add(raw.table);
      projectionTables[`raw_${rawName}`] = raw.table;
    }
  }
  if (Object.keys(projectionTables).length > 0) {
    // unsafePushTables emits raw CREATE TABLE — fine for ephemeral test DBs but
    // collides on re-boot against a persistent DB whose projection tables
    // were created during a previous run. Filter out the ones that already
    // exist; drizzle-kit's diff machinery would otherwise emit CREATE for
    // them again.
    const { tableExists } = await import("../db/schema-inspection");
    const missing: Record<string, unknown> = {};
    for (const [key, tbl] of Object.entries(projectionTables)) {
      const physical = extractTableInfo(tbl).name;
      if (await tableExists(testDb.db, `public.${physical}`)) continue;
      missing[key] = tbl;
    }
    if (Object.keys(missing).length > 0) {
      await unsafePushTables(testDb.db, missing);
    }
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
      ...(options.masterKeyProvider ? { masterKeyProvider: options.masterKeyProvider } : {}),
      ...(typeof options.extraContext === "function"
        ? options.extraContext({ registry, db: testDb.db, sseBroker, redis: testRedis.redis })
        : options.extraContext),
    },
    jwtSecret,
    dispatcherOptions: {
      idempotency,
      ...(options.effectiveFeatures && { effectiveFeatures: options.effectiveFeatures }),
    },
    eventDedup,
    sseBroker,
    // Tests drive the dispatcher via stack.eventDispatcher.runOnce() for
    // deterministic drains — no timer-induced flakiness. pollIntervalMs
    // stays short anyway in case a test opts into `.start()`. pgClient
    // plumbs through the LISTEN wake-up for tests that want to measure
    // post-commit latency (Sprint E.4).
    eventDispatcher: {
      pollIntervalMs: 50,
      pgClient: testDb.client as PgClient | undefined,
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
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
    ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    ...(options.anonymousAccess
      ? {
          anonymousAccess:
            typeof options.anonymousAccess === "function"
              ? options.anonymousAccess({
                  registry,
                  db: testDb.db,
                  sseBroker,
                  redis: testRedis.redis,
                })
              : options.anonymousAccess,
        }
      : {}),
    // Wire the upload routes + ctx.files only when the caller registered a
    // provider. Tests that don't touch files skip both without extra setup.
    ...(options.files
      ? { files: { db: testDb.db, storageProvider: options.files.storageProvider } }
      : {}),
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
    db: testDb.db,
    redis: testRedis,
    search: searchAdapter,
    events,
    http,
    observability: server.observability,
    ...(eventDispatcher ? { eventDispatcher } : {}),
    ...(server.lifecycle ? { lifecycle: server.lifecycle } : {}),
    cleanup: async () => {
      if (eventDispatcher) await eventDispatcher.stop();
      await server.observability.shutdown();
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

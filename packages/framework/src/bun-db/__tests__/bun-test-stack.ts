// Bun.SQL-only setupTestStack mit voller Option-Parität.
// KEIN postgres-js Import. Strukturell identisch zu setupTestStack,
// nur DB-Layer ersetzt: createTestDb → createBunTestDb.
// Kein pgClient für LISTEN — Tests nutzen runOnce() deterministisch.

import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../../api/auth-routes";
import type { JwtHelper } from "../../api/jwt";
import { buildServer } from "../../api/server";
import { createSseBroker } from "../../api/sse-broker";
import { createRegistry } from "../../engine/registry";
import type { FeatureDefinition, Registry, TenantId } from "../../engine/types";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import type { Lifecycle } from "../../lifecycle";
import type { ObservabilityProvider } from "../../observability";
import type { EventDispatcher } from "../../pipeline";
import { createEntityCache, createEventDedup, createIdempotencyGuard } from "../../pipeline";
import { createEventConsumerStateTable, createProjectionStateTable } from "../../pipeline";
import { createInMemorySearchAdapter } from "../../search";
import type { SearchAdapter } from "../../search/types";
import { createEventCollector, type EventCollector } from "../../stack/event-collector";
import { createTestRedis, type TestRedis } from "../../stack/redis";
import { createRequestHelper, type RequestHelper } from "../../stack/request-helper";
import { unsafePushTables } from "../../stack/table-helpers";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createBunTestDb, type BunTestDb } from "./bun-test-db";

export type BunTestStack = {
  app: Hono;
  jwt: JwtHelper;
  registry: Registry;
  db: unknown;
  redis: TestRedis;
  search: SearchAdapter;
  events: EventCollector;
  http: RequestHelper;
  observability: ObservabilityProvider;
  eventDispatcher?: EventDispatcher;
  lifecycle?: Lifecycle;
  cleanup: () => Promise<void>;
};

export type BunTestStackOptions = {
  features: readonly FeatureDefinition[];
  systemHooks?: ("sse" | "search")[];
  searchConfig?: {
    tenantId: TenantId;
    searchableFields: string[];
    rankingFields: string[];
  };
  jwtSecret?: string;
  extraContext?:
    | Record<string, unknown>
    | ((deps: {
        registry: Registry;
        db: unknown;
        sseBroker: import("../../api/sse-broker").SseBroker;
        redis: import("ioredis").default;
      }) => Record<string, unknown>);
  authConfig?: AuthRoutesConfig;
  files?: { storageProvider: import("../../files").FileStorageProvider };
  observability?: ObservabilityProvider;
  lifecycle?: Lifecycle;
  rateLimit?: import("../../api/server").ServerOptions["rateLimit"];
  masterKeyProvider?: import("../../secrets").MasterKeyProvider;
  effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  anonymousAccess?:
    | import("../../api/server").ServerOptions["anonymousAccess"]
     | ((deps: {
         registry: Registry;
         db: unknown;
         sseBroker: import("../../api/sse-broker").SseBroker;
         redis: import("ioredis").default;
       }) => import("../../api/server").ServerOptions["anonymousAccess"]);
};

const DEFAULT_JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

export async function setupBunTestStack(
  options: BunTestStackOptions,
): Promise<BunTestStack> {
  const jwtSecret = options.jwtSecret ?? DEFAULT_JWT_SECRET;
  const enabledHooks = options.systemHooks ?? ["sse", "search"];

  await ensureTemporalPolyfill();

  const [bunDb, testRedis] = await Promise.all([
    createBunTestDb(),
    createTestRedis(),
  ]);

  await createEventsTable(bunDb.db);
  await createArchivedStreamsTable(bunDb.db);
  await createProjectionStateTable(bunDb.db);
  await createEventConsumerStateTable(bunDb.db);

  if (options.files) {
    const { fileRefsTable } = await import("../../files");
    await unsafePushTables(bunDb.db, { fileRefsTable });
  }

  const projectionTables: Record<string, unknown> = {};
  const seenTables = new Set<unknown>();
  for (const feature of options.features) {
    for (const [projName, proj] of Object.entries(feature.projections)) {
      if (seenTables.has(proj.table)) continue;
      seenTables.add(proj.table);
      projectionTables[projName] = proj.table;
    }
    for (const [mspName, msp] of Object.entries(feature.multiStreamProjections)) {
      if (!msp.table) continue;
      if (seenTables.has(msp.table)) continue;
      seenTables.add(msp.table);
      projectionTables[`msp_${mspName}`] = msp.table;
    }
    for (const [rawName, raw] of Object.entries(feature.rawTables)) {
      if (seenTables.has(raw.table)) continue;
      seenTables.add(raw.table);
      projectionTables[`raw_${rawName}`] = raw.table;
    }
  }
  if (Object.keys(projectionTables).length > 0) {
    const { tableExists } = await import("../../db/schema-inspection");
    const { getTableName } = await import("drizzle-orm");
    const missing: Record<string, unknown> = {};
    for (const [key, tbl] of Object.entries(projectionTables)) {
      const physical = getTableName(tbl as Parameters<typeof getTableName>[0]);
      if (await tableExists(bunDb.db, `public.${physical}`)) continue;
      missing[key] = tbl;
    }
    if (Object.keys(missing).length > 0) {
      await unsafePushTables(bunDb.db, missing);
    }
  }

  const searchAdapter = createInMemorySearchAdapter();
  const events = createEventCollector();
  const registry = createRegistry([...options.features]);

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
      db: bunDb.db,
      redis: testRedis.redis,
      searchAdapter,
      entityCache,
      registry,
      ...(options.masterKeyProvider ? { masterKeyProvider: options.masterKeyProvider } : {}),
      ...(typeof options.extraContext === "function"
        ? options.extraContext({ registry, db: bunDb.db, sseBroker, redis: testRedis.redis })
        : options.extraContext),
    },
    jwtSecret,
    dispatcherOptions: {
      idempotency,
      ...(options.effectiveFeatures && { effectiveFeatures: options.effectiveFeatures }),
    },
    eventDedup,
    sseBroker,
    eventDispatcher: {
      pollIntervalMs: 50,
      systemConsumers: {
        sse: enabledHooks.includes("sse"),
        search: enabledHooks.includes("search"),
      },
    },
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
                  db: bunDb.db,
                  sseBroker,
                  redis: testRedis.redis,
                })
              : options.anonymousAccess,
        }
      : {}),
    ...(options.files
      ? { files: { db: bunDb.db, storageProvider: options.files.storageProvider } }
      : {}),
  });

  const eventDispatcher: EventDispatcher | undefined = server.eventDispatcher;

  if (eventDispatcher) await eventDispatcher.ensureRegistered();

  const http = createRequestHelper(server.app, server.jwt);

  return {
    app: server.app,
    jwt: server.jwt,
    registry,
    db: bunDb.db,
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
      await Promise.all([bunDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

// Bun.SQL-only setupTestStack equivalent. KEIN postgres-js Import.
//
// Minimal: ersetzt nur den DB-Teil von setupTestStack (createTestDb →
// createBunTestDb), lässt das HTTP/Redis/Dispatcher-Wiring gleich.
// Kein pgClient für LISTEN — Tests nutzen runOnce() deterministisch.

import { buildServer } from "../../api/server";
import { createSseBroker } from "../../api/sse-broker";
import { createRegistry } from "../../engine/registry";
import type { FeatureDefinition } from "../../engine/types";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import type { EventDispatcher } from "../../pipeline";
import { createEventConsumerStateTable, createProjectionStateTable } from "../../pipeline";
import { createInMemorySearchAdapter } from "../../search";
import { createEventCollector } from "../../stack/event-collector";
import { createTestRedis } from "../../stack/redis";
import { createRequestHelper } from "../../stack/request-helper";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import type { BunTestDb } from "./bun-test-db";
import { createBunTestDb } from "./bun-test-db";

export type BunTestStack = {
  db: Bun.SQL;
  redis: Awaited<ReturnType<typeof createTestRedis>>;
  http: ReturnType<typeof createRequestHelper>;
  events: ReturnType<typeof createEventCollector>;
  search: ReturnType<typeof createInMemorySearchAdapter>;
  eventDispatcher?: EventDispatcher;
  app: ReturnType<typeof buildServer>["app"];
  jwt: ReturnType<typeof buildServer>["jwt"];
  cleanup: () => Promise<void>;
};

export type BunTestStackOptions = {
  features: readonly FeatureDefinition[];
  /** SSE + Search disabled by default (load-aggregate-query doesn't need them) */
  systemHooks?: ("sse" | "search")[];
  /** Forwarded to buildServer */
  anonymousAccess?: Parameters<typeof buildServer>[0]["anonymousAccess"];
};

export async function setupBunTestStack(
  options: BunTestStackOptions,
): Promise<BunTestStack> {
  await ensureTemporalPolyfill();

  const [bunDb, testRedis] = await Promise.all([
    createBunTestDb(),
    createTestRedis(),
  ]);

  await createEventsTable(bunDb.db);
  await createArchivedStreamsTable(bunDb.db);
  await createProjectionStateTable(bunDb.db);
  await createEventConsumerStateTable(bunDb.db);

  const enabledHooks = options.systemHooks ?? ["sse", "search"];
  const searchAdapter = createInMemorySearchAdapter();
  const events = createEventCollector();
  const registry = createRegistry([...options.features]);

  const sseBroker = createSseBroker();
  sseBroker.addClient(
    "tenant:00000000-0000-4000-8000-000000000001",
    (event) => events.sse.push(event),
    () => {},
  );

  const server = buildServer({
    registry,
    context: { db: bunDb.db, redis: testRedis.redis, searchAdapter, registry },
    jwtSecret: "test-stack-secret-minimum-32-characters!!",
    sseBroker,
    eventDispatcher: {
      pollIntervalMs: 50,
      systemConsumers: { sse: enabledHooks.includes("sse"), search: enabledHooks.includes("search") },
    },
    ...(options.anonymousAccess ? { anonymousAccess: options.anonymousAccess } : {}),
  });

  const http = createRequestHelper(server.app, server.jwt);

  if (server.eventDispatcher) {
    await server.eventDispatcher.ensureRegistered();
  }

  return {
    db: bunDb.db,
    redis: testRedis,
    http,
    events,
    search: searchAdapter,
    eventDispatcher: server.eventDispatcher,
    app: server.app,
    jwt: server.jwt,
    cleanup: async () => {
      await server.eventDispatcher?.stop();
      await server.observability.shutdown();
      await Promise.all([bunDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

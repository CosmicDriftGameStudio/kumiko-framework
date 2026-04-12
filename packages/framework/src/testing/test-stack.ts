import type { Hono } from "hono";
import type { JwtHelper } from "../api/jwt";
import { buildServer } from "../api/server";
import { createSseBroker } from "../api/sse-broker";
import { createRegistry } from "../engine/registry";
import type { FeatureDefinition, Registry } from "../engine/types";
import { createEventLog, createIdempotencyGuard } from "../pipeline";
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
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "./index";
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

  const server = buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis, searchAdapter },
    jwtSecret,
    dispatcherOptions: { eventLog, idempotency },
    systemHooks,
    sseBroker,
  });

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
    cleanup: async () => {
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

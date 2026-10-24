import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createSystemDbView,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  bridgeStub,
  createRegistry,
  createTenantConfig,
  defineFeature,
  type Registry,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { createArchivedStreamsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessor, createConfigFeature } from "../../config/feature.ts";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { ConfigHandlers } from "../../config/web/constants.ts";

// --- Setup ---

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let registry: Registry;
let resolver: ConfigResolver;
let jobRunner: JobRunner;

const testEncryptionKey = randomBytes(32).toString("base64");

// Feature with a system-only config key and a job that sets it
const billingFeature = defineFeature("billing", (r) => {
  r.requires({ features: ["config"] });

  r.config({
    keys: {
      monthlyTotal: createTenantConfig("number", {
        default: 0,
        write: access.system,
        read: access.roles("Admin"),
      }),
    },
  });

  // Job that calculates monthly total and writes it via SYSTEM_USER.
  // Post-ES the write path is the config:write:set handler — the old
  // resolver.set escape hatch is gone. checkWriteAccess grants a
  // SYSTEM_ROLE caller the right to write system-only keys that Admin
  // cannot touch, so the security invariant (see Admin test below) holds.
  r.job(
    "calculateTotal",
    {
      trigger: { manual: true },
      escapeHatch: { reason: "test job builds a system-mode handler context for config:write:set" },
    },
    async (_payload, ctx) => {
      const systemUser = ctx["systemUser"] as SessionUser;
      const jobDb = ctx.db.unsafeRaw() as DbConnection;
      const reg = ctx["registry"] as Registry;

      ctx.log?.info("Calculating monthly total...");
      const total = 42000;

      const handler = reg.getWriteHandler("config:write:set");
      if (handler) {
        const parsed = handler.schema.parse({
          key: "billing:config:monthly-total",
          value: total,
        });
        const tenantDb = createTenantDb({
          db: jobDb,
          tenantId: systemUser.tenantId,
          mode: "system",
          reason: "test inspects rows written by a job under the system user",
        });
        await handler.handler(
          { type: "config:write:set", payload: parsed, user: systemUser },
          {
            db: tenantDb,
            dbOutsideTransaction: tenantDb,
            systemDb: createSystemDbView(tenantDb),
            registry: reg,
            configResolver: ctx["configResolver"] as ConfigResolver,
            ...bridgeStub(),
          },
        );
      }

      ctx.log?.info(`Set monthlyTotal to ${total}`);
    },
  );
});

const configFeature = createConfigFeature();

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await unsafePushTables(db, { configValuesTable });
  // Post-ES config writes go through the event-store executor, which needs
  // the framework events + archived-streams tables to exist before the
  // first append. createTestDb only provisions the events table;
  // archived_streams must be created here.
  await createArchivedStreamsTable(db);

  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  resolver = createConfigResolver({ cipher: encryption });

  registry = createRegistry([configFeature, billingFeature]);

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;

  jobRunner = createJobRunner({
    registry,
    context: { db, registry, configResolver: resolver, configEncryption: encryption },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-system-user-test-${Date.now()}`,
  });

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

// --- Tests ---

describe("SYSTEM_USER in jobs", () => {
  test("job sets system-only config via ctx.systemUser", async () => {
    // Dispatch with tenantId in payload so systemUser gets the right tenant
    await jobRunner.dispatch("billing:job:calculate-total", {
      tenantId: "00000000-0000-4000-8000-000000000001",
    });

    // Config should have been set by the job via SYSTEM_USER
    const configFn = createConfigAccessor(
      registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      "11111111-0000-4000-8000-000000000099",
      db,
    );
    let total: unknown;
    await waitFor(async () => {
      total = await configFn("billing:config:monthly-total");
      return total === 42000;
    });
    expect(total).toBe(42000);
    expect(typeof total).toBe("number");
  });

  test("Admin cannot set system-only config directly", async () => {
    const handler = registry.getWriteHandler(ConfigHandlers.set);
    if (!handler) throw new Error("config.set not found");

    const parsed = handler.schema.parse({
      key: "billing:config:monthly-total",
      value: 99999,
    });

    const adminUser = TestUsers.admin;
    const adminTenantDb = createTenantDb({
      db,
      tenantId: adminUser.tenantId,
      mode: "system",
      reason: "test inspects rows written by a job under the system user",
    });
    const result = await handler.handler(
      { type: ConfigHandlers.set, payload: parsed, user: adminUser },
      {
        db: adminTenantDb,
        dbOutsideTransaction: adminTenantDb,
        systemDb: createSystemDbView(adminTenantDb),
        registry,
        configResolver: resolver,
        ...bridgeStub(),
      },
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("access_denied");
      expect(result.error.details).toMatchObject({ reason: "config_key_is_system_only" });
    }
  });

  test("value set by job is still 42000, not overwritten by Admin attempt", async () => {
    const configFn = createConfigAccessor(
      registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      "11111111-0000-4000-8000-000000000001",
      db,
    );
    expect(await configFn("billing:config:monthly-total")).toBe(42000);
  });
});

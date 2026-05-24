import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createEncryptionProvider,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createRegistry,
  createTenantConfig,
  defineFeature,
  type Registry,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub, sleep } from "@cosmicdrift/kumiko-framework/testing";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessor, createConfigFeature } from "../../config/feature";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";

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
  r.requires("config");

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
  r.job("calculateTotal", { trigger: { manual: true } }, async (_payload, ctx) => {
    const systemUser = ctx["systemUser"] as SessionUser;
    const jobDb = ctx["db"] as DbConnection;
    const reg = ctx["registry"] as Registry;

    ctx.log?.info("Calculating monthly total...");
    const total = 42000;

    const handler = reg.getWriteHandler("config:write:set");
    if (handler) {
      const parsed = handler.schema.parse({
        key: "billing:config:monthly-total",
        value: total,
      });
      const tenantDb = createTenantDb(jobDb, systemUser.tenantId, "system");
      await handler.handler(
        { type: "config:write:set", payload: parsed, user: systemUser },
        {
          db: tenantDb,
          registry: reg,
          configResolver: ctx["configResolver"] as ConfigResolver,
          ...bridgeStub(),
        },
      );
    }

    ctx.log?.info(`Set monthlyTotal to ${total}`);
  });
});

const configFeature = createConfigFeature();

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await unsafePushTables(db, { configValuesTable });
  // Post-ES config writes go through the event-store executor, which needs
  // the framework events + archived-streams tables to exist before the
  // first append. setupTestStack provisions them automatically; this test
  // builds its DB manually (createTestDb + unsafePushTables), so we do it here.
  await createEventsTable(db);
  await createArchivedStreamsTable(db);

  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

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
    await sleep(1500);

    // Config should have been set by the job via SYSTEM_USER
    const configFn = createConfigAccessor(
      registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      "11111111-0000-4000-8000-000000000099",
      db,
    );
    const total = await configFn("billing:config:monthly-total");
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
    const result = await handler.handler(
      { type: ConfigHandlers.set, payload: parsed, user: adminUser },
      {
        db: createTenantDb(db, adminUser.tenantId, "system"),
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

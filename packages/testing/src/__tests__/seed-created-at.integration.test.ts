import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CreateKumikoServerOptions,
  type KumikoServerHandle,
  runDevApp,
} from "@cosmicdrift/kumiko-dev-server";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  eventsTable,
  runSeedWritesAt,
  SeedModeDisabledError,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  ConsumerLagError,
  eventConsumerStateTable,
  pruneEvents,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { drainEventConsumers } from "@cosmicdrift/kumiko-framework/stack";
import { request as playwrightRequest } from "@playwright/test";
import * as z from "zod";
import { createHttpApi, loginViaApi } from "../e2e/auth-kit";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import { seedTenantResponseSchema } from "../e2e/seed-contract";
import { createE2eSeedRoutes, type E2eExtraSeeder } from "../e2e/seed-route";

const TOKEN = "seed-created-at-test-token";
const DAY_MS = 24 * 60 * 60 * 1000;
const ENV_KEYS = [
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  "NODE_ENV",
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;

const ADMIN = {
  email: "seed-created-at-admin@example.test",
  password: "seed-created-at-admin-pw-1234",
  displayName: "Admin",
  memberships: [],
};

const noteEntity = createEntity({
  table: "read_seed_created_at_notes",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);
const NOTE_CREATE = "seed-created-at-notes:write:note:create";
const NOTE_UPDATE = "seed-created-at-notes:write:note:update";
const writeAccess = { roles: ["TenantAdmin", "Member", "SystemAdmin"] };

const noteFeature = defineFeature("seed-created-at-notes", (r) => {
  r.entity("note", noteEntity);
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: writeAccess }));
  r.writeHandler(defineEntityUpdateHandler("note", noteEntity, { access: writeAccess }));
});

const backdatedSeedBodySchema = z.strictObject({ daysAgo: z.number() });

const seedBackdatedNote: E2eExtraSeeder = async (ctx, _tenantId, body) => {
  const { daysAgo } = backdatedSeedBodySchema.parse(body);
  const createdAt = Temporal.Now.instant().subtract({ hours: daysAgo * 24 });
  return runSeedWritesAt(createdAt, async () => {
    const created = (await ctx.write(NOTE_CREATE, { title: "old" })) as {
      id: string;
      data: { version: number };
    };
    await ctx.write(NOTE_UPDATE, {
      id: created.id,
      version: created.data.version,
      changes: { title: "older update" },
    });
    return { id: created.id, createdAtMs: createdAt.epochMilliseconds };
  });
};

const seedUnscopedNote: E2eExtraSeeder = async (ctx) => {
  const created = (await ctx.write(NOTE_CREATE, { title: "now" })) as { id: string };
  return { id: created.id };
};

let handle: KumikoServerHandle | undefined;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  process.env[SEED_ENABLE_ENV] = "1";
  process.env[SEED_TOKEN_ENV] = TOKEN;
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function boot() {
  const extraRoutes: NonNullable<CreateKumikoServerOptions["extraRoutes"]> = createE2eSeedRoutes({
    extraSeeders: { backdated: seedBackdatedNote, unscoped: seedUnscopedNote },
  });
  handle = await runDevApp({
    features: [noteFeature],
    port: 0,
    auth: { admin: ADMIN },
    extraRoutes,
  });
  return handle;
}

function post(h: KumikoServerHandle, path: string, body: unknown) {
  return h.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SEED_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(body),
    }),
  );
}

async function seedTenantVia(h: KumikoServerHandle) {
  const res = await post(h, SEED_ROUTES.seedTenant, {});
  expect(res.status).toBe(200);
  return seedTenantResponseSchema.parse(await res.json());
}

async function runSeeder(h: KumikoServerHandle, tenantId: string, seeder: string, body: unknown) {
  const res = await post(h, SEED_ROUTES.extraSeed, { tenantId, seeder, body });
  if (res.status !== 200) throw new Error(`seeder ${seeder}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result: { id: string; createdAtMs: number } }).result;
}

function eventsOf(h: KumikoServerHandle, aggregateId: string) {
  return selectMany<{ id: bigint; version: number; createdAt: Temporal.Instant }>(
    h.stack.db,
    eventsTable,
    { aggregateId },
  );
}

describe("seed writes with a caller-set event time", () => {
  test("a seed write 90 days back lands with that time in the events and the projection row", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);

    const seeded = await runSeeder(h, tenant.id, "backdated", { daysAgo: 90 });

    const events = await eventsOf(h, seeded.id);
    expect(events.map((event) => event.version).sort()).toEqual([1, 2]);
    for (const event of events) {
      expect(event.createdAt.epochMilliseconds).toBe(seeded.createdAtMs);
    }
    const [row] = await selectMany<{ insertedAt: Temporal.Instant; modifiedAt: Temporal.Instant }>(
      h.stack.db,
      noteTable,
      { id: seeded.id },
    );
    expect(row?.insertedAt.epochMilliseconds).toBe(seeded.createdAtMs);
    expect(row?.modifiedAt.epochMilliseconds).toBe(seeded.createdAtMs);
  });

  test("outside the scope the next write is stamped with the real clock again", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);
    await runSeeder(h, tenant.id, "backdated", { daysAgo: 90 });
    const before = Date.now();

    const live = await runSeeder(h, tenant.id, "unscoped", {});

    const [event] = await eventsOf(h, live.id);
    expect(event?.createdAt.epochMilliseconds).toBeGreaterThanOrEqual(before - 1000);
  });

  test("back-dated events keep global id order, reach consumers and stay prunable by age", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);
    const live = await runSeeder(h, tenant.id, "unscoped", {});
    const old = await runSeeder(h, tenant.id, "backdated", { daysAgo: 90 });

    const [liveEvent] = await eventsOf(h, live.id);
    const [oldEvent] = await eventsOf(h, old.id);
    if (!liveEvent || !oldEvent) throw new Error("expected both streams to have events");
    // The back-dated event was written last: higher id, older created_at.
    expect(oldEvent.id > liveEvent.id).toBe(true);
    expect(oldEvent.createdAt.epochMilliseconds).toBeLessThan(
      liveEvent.createdAt.epochMilliseconds,
    );

    const consumers = await selectMany<{ name: string }>(h.stack.db, eventConsumerStateTable);
    const [firstConsumer, ...otherConsumers] = consumers.map((consumer) => consumer.name);
    if (!firstConsumer) throw new Error("expected the stack to register event consumers");
    await drainEventConsumers(h.stack, [firstConsumer, ...otherConsumers]);

    // Cursors are id based: after the drain no consumer lags the back-dated
    // rows, so the age-based prune guard accepts exactly the old stream.
    const pruned = await pruneEvents(h.stack.db, {
      aggregateTypes: ["note"],
      aggregateIds: [old.id, live.id],
      olderThanDays: 30,
      dryRun: true,
    }).catch((error: unknown) => {
      if (error instanceof ConsumerLagError) throw new Error(`consumer lags: ${error.message}`);
      throw error;
    });
    expect(pruned.deletedCount).toBe(2);
  });
});

describe("seed stream order", () => {
  test("a seed write dated before its stream predecessor is rejected", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);
    const old = await runSeeder(h, tenant.id, "backdated", { daysAgo: 10 });
    const [created] = await eventsOf(h, old.id);
    if (!created) throw new Error("expected events");

    const earlier = created.createdAt.subtract({ hours: 24 });
    const result = await runSeedWritesAt(earlier, () =>
      h.stack.dispatcher.write(
        NOTE_UPDATE,
        { id: old.id, version: 2, changes: { title: "too early" } },
        createSystemUser(tenant.id as TenantId, [ROLES.SystemAdmin]),
      ),
    );

    expect(result.isSuccess).toBe(false);
    expect(await eventsOf(h, old.id)).toHaveLength(2);
  });
});

describe("seed-mode boundary", () => {
  test("runSeedWritesAt without seed mode throws and never runs the callback", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);
    const eventsBefore = await selectMany(h.stack.db, eventsTable, { tenantId: tenant.id });
    delete process.env[SEED_ENABLE_ENV];
    let ran = false;

    await expect(
      runSeedWritesAt(Temporal.Now.instant().subtract({ hours: 24 }), async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(SeedModeDisabledError);
    expect(ran).toBe(false);
    expect(await selectMany(h.stack.db, eventsTable, { tenantId: tenant.id })).toHaveLength(
      eventsBefore.length,
    );
  });

  test("runSeedWritesAt under NODE_ENV=production throws even with the flag set", async () => {
    process.env["NODE_ENV"] = "production";

    await expect(runSeedWritesAt(Temporal.Now.instant(), async () => {})).rejects.toBeInstanceOf(
      SeedModeDisabledError,
    );
  });

  test("booting with seed mode and NODE_ENV=production fails", async () => {
    process.env["NODE_ENV"] = "production";

    await expect(
      runDevApp({ features: [noteFeature], port: 0, auth: { admin: ADMIN } }),
    ).rejects.toBeInstanceOf(SeedModeDisabledError);
  });

  test("a normal request cannot set the event time through payload, metadata or headers", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);
    const port = h.server?.port;
    if (port === undefined) throw new Error("runDevApp did not open a socket under Bun");
    const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS).toISOString();
    const context = await playwrightRequest.newContext({
      baseURL: `http://localhost:${port}`,
      extraHTTPHeaders: {
        [SEED_TOKEN_HEADER]: TOKEN,
        "x-seed-created-at": ninetyDaysAgo,
        "x-created-at": ninetyDaysAgo,
        "x-kumiko-created-at": ninetyDaysAgo,
        date: ninetyDaysAgo,
      },
    });
    try {
      await loginViaApi(context, { email: tenant.admin.email, password: tenant.admin.password });
      const before = Date.now();

      const created = await createHttpApi(context).writeOk<{ id: string }>(NOTE_CREATE, {
        title: "from a request",
        createdAt: ninetyDaysAgo,
        insertedAt: ninetyDaysAgo,
        metadata: { createdAt: ninetyDaysAgo },
        seedCreatedAt: ninetyDaysAgo,
      });

      const [event] = await eventsOf(h, created.id);
      expect(event?.createdAt.epochMilliseconds).toBeGreaterThanOrEqual(before - 1000);
    } finally {
      await context.dispose();
    }
  });

  test("the seed route refuses a createdAt in its body", async () => {
    const h = await boot();
    const tenant = await seedTenantVia(h);

    const res = await post(h, SEED_ROUTES.extraSeed, {
      tenantId: tenant.id,
      seeder: "unscoped",
      createdAt: new Date(Date.now() - 90 * DAY_MS).toISOString(),
    });

    expect(res.status).toBe(400);
  });
});

// Two stacks on one Redis namespace and one DB stand in for two API pods: a
// timezone write through pod A must reach pod B's in-process cache.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestDb,
  createTestUser,
  setupTestStack,
  type TestDb,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createConfigAccessorFactory, createConfigFeature } from "../feature.js";
import { createConfigResolver } from "../resolver.js";
import { configValuesTable } from "../table.js";

const tenantFeature = defineFeature("tenant", (r) => {
  r.requires("config");
  r.config({
    keys: {
      timezone: createTenantConfig("select", {
        default: "UTC",
        options: ["UTC", "Europe/Berlin", "Asia/Tokyo"],
        write: access.roles("Admin"),
      }),
    },
  });
});

const probeFeature = defineFeature("probe", (r) => {
  r.requires("tenant");
  // A query, not a write: only tx-free reads populate the timezone cache.
  r.queryHandler("read-tz", z.object({}), async (_event, ctx) => ({ tenant: ctx.tz.tenant }), {
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

async function bootPod(dbName: string, sharedRedisWith?: TestStack): Promise<TestStack> {
  const resolver = createConfigResolver();
  const pod = await setupTestStack({
    features: [createConfigFeature(), tenantFeature, probeFeature],
    dbName,
    persistentDb: true,
    cacheSync: true,
    ...(sharedRedisWith && { sharedRedisWith }),
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(pod.db, { configValuesTable });
  return pod;
}

describe("tenant timezone cache across instances", () => {
  // Owns the shared database's lifecycle; both pods attach to it as persistent.
  let sharedDb: TestDb;
  let podA: TestStack;
  let podB: TestStack;

  beforeAll(async () => {
    sharedDb = await createTestDb();
    podA = await bootPod(sharedDb.dbName);
    podB = await bootPod(sharedDb.dbName, podA);
  });

  afterAll(async () => {
    await podB.cleanup();
    await podA.cleanup();
    await sharedDb.cleanup();
  });

  test("a timezone write on pod A invalidates pod B's warm cache", async () => {
    const admin = createTestUser({ id: 21, roles: ["Admin"] });
    const readOnB = () => podB.http.queryOk<{ tenant: string }>("probe:query:read-tz", {}, admin);

    expect((await readOnB()).tenant).toBe("UTC");

    await podA.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Europe/Berlin" },
      admin,
    );

    await waitFor(async () => (await readOnB()).tenant === "Europe/Berlin");
  });
});

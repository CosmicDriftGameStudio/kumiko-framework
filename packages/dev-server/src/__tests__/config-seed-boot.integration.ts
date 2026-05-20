// Pins the boot-wiring contract for config-seeds. runDevApp's onAfterSetup
// and runProdApp's seed-block both call `seedAllConfigValues(registry, db)`
// — this test simulates that boot moment with a feature declared via
// r.config({ seeds }) and verifies:
//
//   1. seed rows land in the projection after the boot hook runs,
//   2. a re-boot is a no-op (no duplicate rows, no errors),
//   3. an admin set on top of a seed wins the resolver cascade.
//
// If someone ever removes the seedAllConfigValues call from runDevApp /
// runProdApp this test still passes (it calls the helper directly) — but
// the seedAllConfigValues export+wiring is the contract being pinned, so
// dropping it would surface as an import-not-found error here first.

import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
  seedAllConfigValues,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  access,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const bootSeedsFeature = defineFeature("boot-seeds-test", (r) => {
  r.requires("config");
  r.config({
    keys: {
      siteName: createTenantConfig("text", {
        default: "DEFAULT_SITE",
        read: access.all,
        write: access.all,
      }),
      maintenance: createSystemConfig("boolean", {
        default: false,
        read: access.all,
        write: access.systemAdmin,
      }),
    },
    seeds: {
      siteName: createTenantSeed({ value: "from-seed" }),
      maintenance: createSystemSeed({ value: true }),
    },
  });
});

const SITE_KEY = "boot-seeds-test:config:site-name";
const MAINT_KEY = "boot-seeds-test:config:maintenance";

let stack: TestStack;
const resolver = createConfigResolver();

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), bootSeedsFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("config-seed boot wiring", () => {
  test("first boot: seedAllConfigValues writes one row per seed", async () => {
    const result = await seedAllConfigValues(stack.registry, stack.db);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = await stack.db.select().from(configValuesTable);
    expect(rows.length).toBe(2);

    const siteKeyDef = stack.registry.getConfigKey(SITE_KEY);
    expect(siteKeyDef).toBeDefined();
    const sitePeek = await resolver.get(
      SITE_KEY,
      siteKeyDef!,
      TestUsers.systemAdmin.tenantId,
      TestUsers.systemAdmin.id,
      stack.db,
    );
    expect(sitePeek).toBe("from-seed");

    const maintKeyDef = stack.registry.getConfigKey(MAINT_KEY);
    expect(maintKeyDef).toBeDefined();
    const maintPeek = await resolver.get(
      MAINT_KEY,
      maintKeyDef!,
      TestUsers.systemAdmin.tenantId,
      TestUsers.systemAdmin.id,
      stack.db,
    );
    expect(maintPeek).toBe(true);
  });

  test("re-boot: idempotent — every seed already on disk → all skipped", async () => {
    const result = await seedAllConfigValues(stack.registry, stack.db);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);

    const rows = await stack.db.select().from(configValuesTable);
    expect(rows.length).toBe(2);
  });

  test("admin set overrides seed; subsequent boot keeps admin value", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: SITE_KEY, value: "admin-override", scope: "tenant" },
      TestUsers.systemAdmin,
    );

    // Re-boot — seed-row already exists with a different aggregate stream
    // (admin wrote via random-id), so seedAllConfigValues sees the unique
    // (key, tenantId, userId) collision and skips. The admin value wins
    // because higher-version stream owns the projection row.
    const result = await seedAllConfigValues(stack.registry, stack.db);
    expect(result.skipped).toBe(2);

    const siteKeyDef = stack.registry.getConfigKey(SITE_KEY);
    expect(siteKeyDef).toBeDefined();
    const peek = await resolver.get(
      SITE_KEY,
      siteKeyDef!,
      TestUsers.systemAdmin.tenantId,
      TestUsers.systemAdmin.id,
      stack.db,
    );
    expect(peek).toBe("admin-override");
  });
});

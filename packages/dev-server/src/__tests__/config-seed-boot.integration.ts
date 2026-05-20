// Pins the boot-wiring contract for config-seeds. runDevApp's onAfterSetup
// and runProdApp's seed-block both call `applyBootSeeds(...)` — this test
// calls the SAME helper, so if someone removes the call site from
// runDevApp / runProdApp the helper still has at least one caller (this
// test). Code review then sees an orphaned helper, not a silently broken
// boot. For a stricter end-to-end pin you'd start an actual runDevApp;
// that's heavy and not done here.
//
// Tests:
//   1. seed rows land in the projection after applyBootSeeds runs,
//   2. a re-boot is a no-op (idempotent),
//   3. an admin set on top of a seed wins the resolver cascade; coexistence
//      vs. override semantics depend on the admin user's tenantId.

import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { applyBootSeeds } from "../boot/apply-boot-seeds";
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
  test("first boot: applyBootSeeds writes one row per seed", async () => {
    await applyBootSeeds({ registry: stack.registry, db: stack.db });

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

  test("re-boot: idempotent — every seed already on disk → no extra rows", async () => {
    await applyBootSeeds({ registry: stack.registry, db: stack.db });

    const rows = await stack.db.select().from(configValuesTable);
    expect(rows.length).toBe(2);
  });

  test("admin set on top of seed wins resolver — Re-Boot preserves admin", async () => {
    // siteName is a TENANT-scope key. The seed writes a row under
    // SYSTEM_TENANT_ID (= "for all tenants"). An admin on a real tenant
    // writes a row under THAT tenantId — higher specificity. Both rows
    // coexist; the resolver returns the more specific one.
    //
    // If the admin happens to write as SYSTEM_TENANT_ID (e.g. test user
    // is the system-admin on the system-tenant), the admin write hits
    // the seed-row directly and updates the same aggregate stream. Both
    // paths end up with the admin value winning — the row-count
    // assertion makes the path explicit.
    await stack.http.writeOk(
      "config:write:set",
      { key: SITE_KEY, value: "admin-override", scope: "tenant" },
      TestUsers.systemAdmin,
    );

    await applyBootSeeds({ registry: stack.registry, db: stack.db });

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

    // Row-count tells us which path was hit:
    //   - 2 rows = override path (admin tenantId === SYSTEM_TENANT_ID,
    //     updated the seed-stream in place).
    //   - 3 rows = coexistence path (admin tenantId !== SYSTEM_TENANT_ID,
    //     new specific-tenant row sits next to the seed system-row).
    // Either is correct as long as the resolver picks the admin value.
    const rows = await stack.db.select().from(configValuesTable);
    expect([2, 3]).toContain(rows.length);
  });
});

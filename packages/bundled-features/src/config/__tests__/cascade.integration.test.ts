import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedConfigValues } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigCascade,
  ConfigKeyDefinition,
  ConfigKeyType,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  access,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createUserConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { buildEnvConfigOverrides, type ConfigResolver, createConfigResolver } from "../resolver";
import { configValueEntity, configValuesTable } from "../table";

let stack: TestStack;
let db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
let resolver: ConfigResolver;

const tenantAdmin = createTestUser({ id: 2 });

const cascadeFeature = defineFeature("cascade-test", (r) => {
  r.requires("config");

  r.config({
    keys: {
      tenantKey: createTenantConfig("text", {
        default: "DEFAULT_TENANT",
        read: access.all,
        write: access.all,
      }),
      userKey: createUserConfig("text", {
        default: "DEFAULT_USER",
        read: access.all,
        write: access.all,
      }),
      // User-scope key whose only stored row is a system-row (via seed).
      // Exercises the user → tenant → SYSTEM_TENANT_ID cascade rung.
      userInheritKey: createUserConfig("text", {
        default: "DEFAULT_USER_INHERIT",
        read: access.all,
        write: access.all,
      }),
      systemKey: createSystemConfig("text", {
        default: "DEFAULT_SYSTEM",
        read: access.systemAdmin,
        write: access.systemAdmin,
      }),
      numberKey: createTenantConfig("number", {
        default: 0,
        read: access.all,
        write: access.all,
      }),
      booleanKey: createTenantConfig("boolean", {
        default: false,
        read: access.all,
        write: access.all,
      }),
      computedKey: createTenantConfig("number", {
        // Plan-based stub: always returns 42 so the test can assert the
        // `computed` level shows up between app-override and default.
        computed: async () => 42,
        read: access.all,
        write: access.all,
      }),
      // End-to-end seam key: a plain scope factory carrying an `env` binding
      // so buildEnvConfigOverrides reads it off the real registry under the
      // qualified name define-feature assigns.
      envKey: createSystemConfig("text", {
        env: "CASCADE_ENV_VALUE",
        default: "DEFAULT_ENV",
        read: access.all,
        write: access.all,
      }),
    },
    seeds: {
      tenantKey: createTenantSeed({ value: "SEED_TENANT" }),
      systemKey: createSystemSeed({ value: "SEED_SYSTEM" }),
      userInheritKey: createSystemSeed({ value: "SEED_SYSTEM_FOR_USER" }),
    },
  });
});

const configFeature = createConfigFeature();

const TENANT_KEY = "cascade-test:config:tenant-key";
const USER_KEY = "cascade-test:config:user-key";
const USER_INHERIT_KEY = "cascade-test:config:user-inherit-key";
const SYSTEM_KEY = "cascade-test:config:system-key";
const NUMBER_KEY = "cascade-test:config:number-key";
const BOOLEAN_KEY = "cascade-test:config:boolean-key";
const COMPUTED_KEY = "cascade-test:config:computed-key";
const ENV_KEY = "cascade-test:config:env-key";

beforeAll(async () => {
  resolver = createConfigResolver();

  stack = await setupTestStack({
    features: [configFeature, cascadeFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;

  // Materialise the config-values projection table
  await unsafePushTables(db, { configValuesTable });

  // Execute seeds defined in the cascade-test feature
  const seedDefs = stack.registry
    .getAllConfigSeeds()
    .filter((s) => s.key.startsWith("cascade-test:"));
  await seedConfigValues(seedDefs, configValuesTable, configValueEntity, stack.registry, db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("getCascade", () => {
  test("tenant-scope key with system-row (from seed) + default", async () => {
    const keyDef = stack.registry.getConfigKey(TENANT_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      TENANT_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    expect(cascade.levels.length).toBeGreaterThanOrEqual(4);
    // Seed creates a system-row (tenantId = SYSTEM_TENANT_ID)
    const systemLevel = cascade.levels.find((l) => l.source === "system-row");
    expect(systemLevel).toBeDefined();
    expect(systemLevel?.hasValue).toBe(true);
    expect(systemLevel?.value).toBe("SEED_TENANT");

    // No tenant-row for this tenant
    const tenantLevel = cascade.levels.find((l) => l.source === "tenant-row");
    expect(tenantLevel).toBeDefined();
    expect(tenantLevel?.hasValue).toBe(false);

    const defaultLevel = cascade.levels.find((l) => l.source === "default");
    expect(defaultLevel).toBeDefined();

    const activeLevels = cascade.levels.filter((l) => l.isActive);
    expect(activeLevels.length).toBe(1);
    expect(activeLevels[0]?.source).toBe("system-row");
  });

  test("tenant-scope key without tenant-row — default active", async () => {
    const keyDef = stack.registry.getConfigKey(NUMBER_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      NUMBER_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    expect(cascade.levels.length).toBeGreaterThanOrEqual(4);

    const tenantLevel = cascade.levels.find((l) => l.source === "tenant-row");
    expect(tenantLevel).toBeDefined();
    expect(tenantLevel?.hasValue).toBe(false);

    const systemLevel = cascade.levels.find((l) => l.source === "system-row");
    expect(systemLevel).toBeDefined();
    expect(systemLevel?.hasValue).toBe(false);

    const activeLevels = cascade.levels.filter((l) => l.isActive);
    expect(activeLevels.length).toBe(1);
    expect(activeLevels[0]?.source).toBe("default");
    expect(activeLevels[0]?.value).toBe(0);
  });

  test("tenant-scope key with default only (no rows)", async () => {
    const keyDef = stack.registry.getConfigKey(BOOLEAN_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      BOOLEAN_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const activeLevels = cascade.levels.filter((l) => l.isActive);
    expect(activeLevels.length).toBe(1);
    expect(activeLevels[0]?.source).toBe("default");
    expect(activeLevels[0]?.value).toBe(false);
  });

  test("user-scope key with user + tenant-row", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: USER_KEY, value: "TENANT_VAL", scope: "tenant" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: USER_KEY, value: "USER_VAL", scope: "user" },
      tenantAdmin,
    );

    const keyDef = stack.registry.getConfigKey(USER_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      USER_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const userLevel = cascade.levels.find((l) => l.source === "user-row");
    expect(userLevel).toBeDefined();
    expect(userLevel?.value).toBe("USER_VAL");
    expect(userLevel?.isActive).toBe(true);

    const tenantLevel = cascade.levels.find((l) => l.source === "tenant-row");
    expect(tenantLevel).toBeDefined();
    expect(tenantLevel?.value).toBe("TENANT_VAL");
    expect(tenantLevel?.isActive).toBe(false);
  });

  test("user-scope key falls through to system-row when no user/tenant row exists", async () => {
    // No user-row, no tenant-row for this key — only a seeded system-row.
    // Before the user-cascade gained a SYSTEM_TENANT_ID rung, this resolved
    // straight to the static default, skipping the operator-set system value.
    const keyDef = stack.registry.getConfigKey(USER_INHERIT_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      USER_INHERIT_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const userLevel = cascade.levels.find((l) => l.source === "user-row");
    expect(userLevel?.hasValue).toBe(false);
    const tenantLevel = cascade.levels.find((l) => l.source === "tenant-row");
    expect(tenantLevel?.hasValue).toBe(false);

    const systemLevel = cascade.levels.find((l) => l.source === "system-row");
    expect(systemLevel).toBeDefined();
    expect(systemLevel?.hasValue).toBe(true);
    expect(systemLevel?.value).toBe("SEED_SYSTEM_FOR_USER");
    expect(systemLevel?.isActive).toBe(true);

    expect(cascade.value).toBe("SEED_SYSTEM_FOR_USER");
    expect(cascade.source).toBe("system-row");
  });

  test("system-scope key with system-row + default", async () => {
    const keyDef = stack.registry.getConfigKey(SYSTEM_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      SYSTEM_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    expect(cascade.levels.length).toBeGreaterThanOrEqual(3);
    const systemLevel = cascade.levels.find((l) => l.source === "system-row");
    expect(systemLevel).toBeDefined();
    expect(systemLevel?.hasValue).toBe(true);
    expect(systemLevel?.value).toBe("SEED_SYSTEM");
    expect(systemLevel?.isActive).toBe(true);
  });
});

describe("getCascadeBatch", () => {
  test("batch returns cascades for multiple keys", async () => {
    const keys = [TENANT_KEY, NUMBER_KEY, BOOLEAN_KEY];
    const keyDefs = new Map<string, ConfigKeyDefinition<ConfigKeyType>>();
    for (const k of keys) {
      const keyDef = stack.registry.getConfigKey(k);
      if (keyDef) keyDefs.set(k, keyDef);
    }

    const cascades = await resolver.getCascadeBatch(
      keys,
      keyDefs,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    expect(cascades.size).toBe(3);
    for (const [, cascade] of cascades) {
      expect(cascade.levels.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("empty keys returns empty map", async () => {
    const cascades = await resolver.getCascadeBatch(
      [],
      new Map(),
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(cascades.size).toBe(0);
  });

  test("user-scope key resolves its system-row via the batch preload", async () => {
    // The batch path preloads rows with selectConfigRowsForKeys (no scope
    // gate) and matches them per (tenantId, userId) in buildCascade. This
    // pins that a user-scope key's system-row is preloaded AND surfaced —
    // the single-key path proves the lookup, this proves the preload feeds it.
    const keyDef = stack.registry.getConfigKey(USER_INHERIT_KEY);
    expect(keyDef).toBeDefined();
    const keyDefs = new Map<string, ConfigKeyDefinition<ConfigKeyType>>([
      [USER_INHERIT_KEY, keyDef!],
    ]);

    const cascades = await resolver.getCascadeBatch(
      [USER_INHERIT_KEY],
      keyDefs,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const cascade = cascades.get(USER_INHERIT_KEY);
    expect(cascade).toBeDefined();
    const systemLevel = cascade?.levels.find((l) => l.source === "system-row");
    expect(systemLevel?.hasValue).toBe(true);
    expect(systemLevel?.value).toBe("SEED_SYSTEM_FOR_USER");
    expect(systemLevel?.isActive).toBe(true);
    expect(cascade?.value).toBe("SEED_SYSTEM_FOR_USER");
    expect(cascade?.source).toBe("system-row");
  });
});

describe("cascade levels — non-DB sources", () => {
  test("computed key shows as active computed level when no row exists", async () => {
    const keyDef = stack.registry.getConfigKey(COMPUTED_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await resolver.getCascade(
      COMPUTED_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const computedLevel = cascade.levels.find((l) => l.source === "computed");
    expect(computedLevel).toBeDefined();
    expect(computedLevel?.hasValue).toBe(true);
    expect(computedLevel?.value).toBe(42);
    expect(computedLevel?.isActive).toBe(true);
    expect(cascade.value).toBe(42);
    expect(cascade.source).toBe("computed");
  });

  test("app-override appears above computed/default when set in resolver options", async () => {
    // Build a one-off resolver with appOverrides to verify the cascade
    // surfaces the override-level — main `resolver` is plain and would
    // skip this path.
    const overrideResolver = createConfigResolver({
      appOverrides: new Map<string, string | number | boolean>([[BOOLEAN_KEY, true]]),
    });
    const keyDef = stack.registry.getConfigKey(BOOLEAN_KEY);
    expect(keyDef).toBeDefined();

    const cascade = await overrideResolver.getCascade(
      BOOLEAN_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const overrideLevel = cascade.levels.find((l) => l.source === "app-override");
    expect(overrideLevel).toBeDefined();
    expect(overrideLevel?.hasValue).toBe(true);
    expect(overrideLevel?.value).toBe(true);
    expect(overrideLevel?.isActive).toBe(true);
    // System-row stays empty; tenant-row also empty → override wins.
    expect(cascade.value).toBe(true);
    expect(cascade.source).toBe("app-override");
  });

  test("end-to-end: env-declared key bridges through the real registry to the resolver", async () => {
    // The single flow none of the per-layer tests cover: a key declared via
    // createSystemConfig({ env }) on the REAL registry → its qualified
    // name (define-feature-assigned) → buildEnvConfigOverrides emits exactly
    // that key off getAllConfigKeys → resolver resolves it as app-override.
    // A mismatch in key-qualification across registry/bridge/resolver would
    // leave the per-layer stub/registry tests green and only break on the
    // first real consumer. This pins the seam at a real qualified string.
    const keyDef = stack.registry.getConfigKey(ENV_KEY);
    expect(keyDef).toBeDefined();
    expect(keyDef?.env).toBe("CASCADE_ENV_VALUE");

    const overrides = buildEnvConfigOverrides(stack.registry, {
      CASCADE_ENV_VALUE: "from-env",
    });
    expect(overrides.get(ENV_KEY)).toBe("from-env");

    const envResolver = createConfigResolver({ appOverrides: overrides });
    const result = await envResolver.getWithSource(
      ENV_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    // No stored rows for this key → the env-bridged override wins over the
    // declared default ("DEFAULT_ENV").
    expect(result.source).toBe("app-override");
    expect(result.value).toBe("from-env");
  });
});

describe("reset cycle regression", () => {
  // Pins the executor-create-with-fresh-id contract: hard-delete +
  // re-set must hit a NEW aggregate stream, never version_conflict
  // against the deleted one. If someone ever flips configValueEntity
  // to deterministic IDs without adjusting set.write.ts, this test
  // will catch the regression.
  test("set → reset → set succeeds (no version_conflict)", async () => {
    const RESET_KEY = NUMBER_KEY;

    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: RESET_KEY, value: 11, scope: "tenant" },
      tenantAdmin,
    );

    await stack.http.writeOk(
      ConfigHandlers.reset,
      { key: RESET_KEY, scope: "tenant" },
      tenantAdmin,
    );

    // Second set after reset — would version_conflict if the executor
    // re-used the deleted stream's aggregateId.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: RESET_KEY, value: 22, scope: "tenant" },
      tenantAdmin,
    );

    const keyDef = stack.registry.getConfigKey(RESET_KEY);
    expect(keyDef).toBeDefined();
    const cascade = await resolver.getCascade(
      RESET_KEY,
      keyDef!,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(cascade.value).toBe(22);
    expect(cascade.source).toBe("tenant-row");
  });
});

describe("config:query:cascade handler", () => {
  test("systemAdmin sees all keys including SystemAdmin-restricted ones", async () => {
    const data = await stack.http.queryOk<Record<string, ConfigCascade>>(
      ConfigQueries.cascade,
      {},
      TestUsers.systemAdmin,
    );

    expect(data[TENANT_KEY]).toBeDefined();
    expect(data[NUMBER_KEY]).toBeDefined();
    expect(data[BOOLEAN_KEY]).toBeDefined();
    expect(data[SYSTEM_KEY]).toBeDefined();

    for (const cascade of Object.values(data)) {
      expect(cascade.levels).toBeDefined();
      expect(Array.isArray(cascade.levels)).toBe(true);
    }
  });

  test("filters to specific keys when keys param is set", async () => {
    const data = await stack.http.queryOk<Record<string, ConfigCascade>>(
      ConfigQueries.cascade,
      { keys: [TENANT_KEY] },
      tenantAdmin,
    );

    expect(Object.keys(data).length).toBe(1);
    expect(data[TENANT_KEY]).toBeDefined();
  });

  test("user without read access does not see SystemAdmin-restricted key", async () => {
    const data = await stack.http.queryOk<Record<string, ConfigCascade>>(
      ConfigQueries.cascade,
      {},
      createTestUser({ id: 99, roles: ["User"] }),
    );

    expect(data[SYSTEM_KEY]).toBeUndefined();
    // But keys with `read: access.all` stay visible to plain users.
    expect(data[TENANT_KEY]).toBeDefined();
  });
});

// getAll / getAllWithSource are bulk readers used by admin UIs — never
// reached via the cascade query handlers above, so they stay uncovered
// unless called directly on the resolver.
describe("getAll / getAllWithSource", () => {
  test("getAll picks the most specific row (user > tenant > system)", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: TENANT_KEY, value: "TENANT_BULK" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: USER_KEY, value: "USER_BULK" },
      tenantAdmin,
    );

    const all = await resolver.getAll(tenantAdmin.tenantId, tenantAdmin.id, db);
    // getAll returns raw stored strings (JSON-serialized); deserialize for asserts.
    expect(JSON.parse(all.get(TENANT_KEY)?.value ?? "null")).toBe("TENANT_BULK");
    expect(JSON.parse(all.get(USER_KEY)?.value ?? "null")).toBe("USER_BULK");
    // System seed still present for keys without a more-specific row.
    expect(JSON.parse(all.get(SYSTEM_KEY)?.value ?? "null")).toBe("SEED_SYSTEM");
  });

  test("getAllWithSource tags the winning row's source", async () => {
    const withSource = await resolver.getAllWithSource(
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );

    const userRow = withSource.get(USER_KEY);
    expect(userRow?.source).toBe("user-row");
    expect(JSON.parse(userRow?.value ?? "null")).toBe("USER_BULK");

    const tenantRow = withSource.get(TENANT_KEY);
    expect(tenantRow?.source).toBe("tenant-row");

    const systemRow = withSource.get(SYSTEM_KEY);
    expect(systemRow?.source).toBe("system-row");
  });
});


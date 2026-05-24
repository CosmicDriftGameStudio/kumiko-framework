import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/query";
import {
  createEntity,
  createSystemConfig,
  createTenantConfig,
  createTextField,
  createUserConfig,
  SYSTEM_TENANT_ID,
} from "../../engine";
import type { ConfigSeedDef, Registry } from "../../engine/types";
import { unsafeCreateEntityTable } from "../../stack";
import { createBunTestDb, type BunTestDb } from "../../bun-db/__tests__/bun-test-db";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { seedConfigValues } from "../config-seed";
import { createEncryptionProvider } from "../encryption";
import { buildEntityTable } from "../table-builder";

// --- Test Entity ---
// Mirrors the config-value entity from bundled-features with a unique
// table name so it never collides with the real config table.
const configEntity = createEntity({
  table: "read_cfg_seed_test",
  fields: {
    key: createTextField({ required: true }),
    value: createTextField({}),
    userId: createTextField({}),
  },
  indexes: [
    {
      unique: true,
      columns: ["key", "tenantId", "userId"],
      name: "cfg_seed_test_unique",
    },
  ],
});
const configTable = buildEntityTable("cfgSeedTest", configEntity);

// --- Registry Stub ---
const KEY_DEFS = {
  "test:config:service-url": createSystemConfig("text", {
    default: "https://default.example.com",
  }),
  "test:config:max-upload": createTenantConfig("number", { default: 10 }),
  "test:config:stripe-key": createTenantConfig("text", { encrypted: true }),
  "test:config:theme": createUserConfig("text", { default: "blue" }),
};

const mockRegistry = {
  getConfigKey: (key: string) => KEY_DEFS[key as keyof typeof KEY_DEFS] ?? undefined,
} as unknown as Registry;

// --- Helpers ---
const encryption = createEncryptionProvider(
  Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
);

let testDb: BunTestDb;

async function countRows(): Promise<number> {
  const [r] = await asRawClient(testDb.db).unsafe<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM read_cfg_seed_test`,
  );
  return r?.count ?? 0;
}

async function countEvents(): Promise<number> {
  const [r] = await asRawClient(testDb.db).unsafe<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM kumiko_events`,
  );
  return r?.count ?? 0;
}

// --- Setup ---
beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createBunTestDb();
  await unsafeCreateEntityTable(testDb.db, configEntity, "cfgSeedTest");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_cfg_seed_test RESTART IDENTITY CASCADE`,
  );
});

// --- Tests ---

describe("seedConfigValues", () => {
  test("inserts initial seeds — creates rows + events", async () => {
    const TENANT_A = "22222222-2222-4222-8222-222222222222";
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:service-url", value: "https://prod.example.com", scope: "system" },
      { key: "test:config:max-upload", value: 50, scope: "tenant" },
      {
        key: "test:config:theme",
        value: "dark",
        scope: "user",
        tenantId: TENANT_A,
        userId: "u-123",
      },
    ];

    const result = await seedConfigValues(
      seeds,
      configTable,
      configEntity,
      mockRegistry,
      testDb.db,
    );

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(await countRows()).toBe(3);
    expect(await countEvents()).toBe(3);
  });

  test("idempotent re-run — all skipped", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:service-url", value: "https://prod.example.com", scope: "system" },
    ];

    const first = await seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db);
    expect(first).toEqual({ created: 1, skipped: 0 });

    const second = await seedConfigValues(
      seeds,
      configTable,
      configEntity,
      mockRegistry,
      testDb.db,
    );
    expect(second).toEqual({ created: 0, skipped: 1 });
  });

  test("insert-only — value change ignored on re-boot", async () => {
    const seeds: ConfigSeedDef[] = [{ key: "test:config:max-upload", value: 10, scope: "tenant" }];

    await seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db);

    const seedsChanged: ConfigSeedDef[] = [
      { key: "test:config:max-upload", value: 999, scope: "tenant" },
    ];
    const result = await seedConfigValues(
      seedsChanged,
      configTable,
      configEntity,
      mockRegistry,
      testDb.db,
    );
    expect(result).toEqual({ created: 0, skipped: 1 });

    // Old value persists
    const [row] = await asRawClient(testDb.db).unsafe<{ value: string }>(
      `SELECT value FROM read_cfg_seed_test WHERE key = 'test:config:max-upload' LIMIT 1`,
    );
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toBe(10);
  });

  test("scope mapping — system/tenant under SYSTEM_TENANT_ID, user under real tenantId", async () => {
    const TENANT_A = "11111111-1111-4111-8111-111111111111";

    const seeds: ConfigSeedDef[] = [
      { key: "test:config:service-url", value: "x", scope: "system" },
      { key: "test:config:max-upload", value: 20, scope: "tenant" },
      { key: "test:config:theme", value: "dark", scope: "user", tenantId: TENANT_A, userId: "u-1" },
    ];

    await seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db);

    const rows = await asRawClient(testDb.db).unsafe<{
      key: string;
      tenantId: string | null;
      userId: string | null;
    }>(
      `SELECT key, tenant_id AS "tenantId", user_id AS "userId" FROM read_cfg_seed_test ORDER BY key`,
    );

    const sys = rows.find((r: Record<string, unknown>) => r["key"] === "test:config:service-url");
    const tnt = rows.find((r: Record<string, unknown>) => r["key"] === "test:config:max-upload");
    const usr = rows.find((r: Record<string, unknown>) => r["key"] === "test:config:theme");

    expect(sys!["tenantId"]).toBe(SYSTEM_TENANT_ID);
    expect(sys!["userId"]).toBeNull();

    expect(tnt!["tenantId"]).toBe(SYSTEM_TENANT_ID);
    expect(tnt!["userId"]).toBeNull();

    // user-scope seed must live under the user's actual tenantId so the
    // resolver cascade can match it — never under SYSTEM_TENANT_ID.
    expect(usr!["tenantId"]).toBe(TENANT_A);
    expect(usr!["userId"]).toBe("u-1");
  });

  test("user-scope seed without tenantId throws (would be unreachable)", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:theme", value: "dark", scope: "user", userId: "u-1" },
    ];

    await expect(
      seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db),
    ).rejects.toThrow(/user-scope seed.*requires both tenantId and userId/);
  });

  test("encrypted seed without EncryptionProvider throws — fail loud at boot", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:stripe-key", value: "sk_live_xxx", scope: "tenant" },
    ];

    await expect(
      seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db),
    ).rejects.toThrow(/encrypted but no EncryptionProvider/);
  });

  test("encrypted seed with provider stores ciphertext, not plaintext", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:stripe-key", value: "sk_live_secret_token", scope: "tenant" },
    ];

    const result = await seedConfigValues(
      seeds,
      configTable,
      configEntity,
      mockRegistry,
      testDb.db,
      encryption,
    );
    expect(result).toEqual({ created: 1, skipped: 0 });

    const [row] = await asRawClient(testDb.db).unsafe<{ value: string }>(
      `SELECT value FROM read_cfg_seed_test WHERE key = 'test:config:stripe-key' LIMIT 1`,
    );
    expect(row).toBeDefined();
    // value column holds ciphertext, never the plain token. The
    // resolver later runs `decrypt → JSON.parse` to get the primitive
    // back; we replay the same round-trip here.
    expect(row!.value).not.toContain("sk_live_secret_token");
    expect(JSON.parse(encryption.decrypt(row!.value))).toBe("sk_live_secret_token");
  });

  test("race-safe parallel boot — two concurrent calls result in 1 created + 1 skipped", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:service-url", value: "race-target", scope: "system" },
    ];

    const [a, b] = await Promise.all([
      seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db),
      seedConfigValues(seeds, configTable, configEntity, mockRegistry, testDb.db),
    ]);

    const totalCreated = (a.created ?? 0) + (b.created ?? 0);
    const totalSkipped = (a.skipped ?? 0) + (b.skipped ?? 0);
    expect(totalCreated).toBe(1);
    expect(totalSkipped).toBe(1);
    expect(await countRows()).toBe(1);
  });

  test("unknown key — skipped gracefully", async () => {
    const seeds: ConfigSeedDef[] = [
      { key: "test:config:nonexistent", value: "nope", scope: "tenant" },
    ];

    const result = await seedConfigValues(
      seeds,
      configTable,
      configEntity,
      mockRegistry,
      testDb.db,
    );

    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(await countRows()).toBe(0);
  });

  test("empty seeds returns 0/0", async () => {
    const result = await seedConfigValues([], configTable, configEntity, mockRegistry, testDb.db);
    expect(result).toEqual({ created: 0, skipped: 0 });
  });
});

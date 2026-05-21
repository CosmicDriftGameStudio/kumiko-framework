// Integration-Tests für SeedMigrationContext-Read-Helpers + skippable-
// integration. Verifizieren dass:
// - findUserByEmail liest read_users korrekt (typed result-cast)
// - findMembershipsOfUser parst JSON-encoded roles korrekt
// - findTenants returnt sorted-by-inserted_at
// - skippable + env-flag: kein marker geschrieben (gegen real-DB)
// - ctx.db ist DbRunner (Escape-Hatch für direct-reads)
//
// Schema-stubs sind raw CREATE TABLE, weil das vollständige user/tenant-
// Feature in den Tests zu schwer wäre — wir testen nur den Read-Helper-
// Layer, nicht die volle Event-Store-Pipeline.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDb, type TestDb } from "../../stack";
import { createSeedMigrationContext } from "../context";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema";
import { runPendingSeedMigrations } from "../runner";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEsOperationsTable(testDb.db);

  // Minimal-Schema-Stubs für die 3 Read-Tabellen die context.ts liest.
  // Spalten matchen production (siehe Sysadmin-Stream-Tenant-Bug Memory).
  await testDb.db.execute(sql`
    CREATE TABLE IF NOT EXISTS read_users (
      id          uuid PRIMARY KEY,
      email       text NOT NULL,
      tenant_id   uuid NOT NULL
    );
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     text NOT NULL,
      tenant_id   uuid NOT NULL,
      roles       text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS read_tenants (
      id            uuid PRIMARY KEY,
      name          text NOT NULL,
      tenant_key    text NOT NULL,
      inserted_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(sql`
    TRUNCATE kumiko_es_operations, kumiko_events, read_users, read_tenant_memberships, read_tenants
    RESTART IDENTITY CASCADE
  `);
});

// Helper: simulate `seedTenantMembership` writing both the read-row and
// its v1-event with a custom stream-tenant. Tests use this to construct
// the stream-vs-payload-tenant scenarios that drive the JOIN-helper.
async function insertMembershipWithEvent(args: {
  readonly id: string;
  readonly userId: string;
  readonly payloadTenantId: string;
  readonly streamTenantId: string;
  readonly roles: string;
}): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO read_tenant_memberships (id, user_id, tenant_id, roles)
    VALUES (${args.id}::uuid, ${args.userId}, ${args.payloadTenantId}::uuid, ${args.roles})
  `);
  await testDb.db.execute(sql`
    INSERT INTO kumiko_events
      (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
    VALUES
      (${args.id}::uuid, 'tenant-membership', ${args.streamTenantId}::uuid, 1,
       'tenant-membership.created', '{}'::jsonb, '{"userId":"system"}'::jsonb, 'system')
  `);
}

function makeMockDispatcher() {
  return {
    write: vi.fn(async () => ({ isSuccess: true as const, data: {} })),
    query: vi.fn(),
    command: vi.fn(),
    batch: vi.fn(),
    resolveAuthClaims: vi.fn(),
  };
}

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-ctx-integ-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

// --- Read-Helpers --------------------------------------------------------

describe("SeedMigrationContext.findUserByEmail (integration)", () => {
  test("liest existing user-row korrekt + maps tenant_id → tenantId", async () => {
    const userId = "01900000-0000-7000-8000-000000000001";
    const tenantId = "00000000-0000-4000-8000-000000000099";
    await testDb.db.execute(sql`
      INSERT INTO read_users (id, email, tenant_id)
      VALUES (${userId}::uuid, 'admin@example.com', ${tenantId}::uuid)
    `);

    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const found = await ctx.findUserByEmail("admin@example.com");
    expect(found).toEqual({ id: userId, email: "admin@example.com", tenantId });
  });

  test("liefert null bei unknown email (kein throw)", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const found = await ctx.findUserByEmail("does-not-exist@example.com");
    expect(found).toBeNull();
  });
});

describe("SeedMigrationContext.findMembershipsOfUser (integration)", () => {
  test("parst JSON-encoded roles-Spalte zu string[]", async () => {
    const userId = "01900000-0000-7000-8000-000000000001";
    const aggId1 = "00000000-0000-4000-8000-0000000000a1";
    const aggId2 = "00000000-0000-4000-8000-0000000000a2";
    const tenantId1 = "00000000-0000-4000-8000-000000000001";
    const tenantId2 = "00000000-0000-4000-8000-000000000002";
    await insertMembershipWithEvent({
      id: aggId1,
      userId,
      payloadTenantId: tenantId1,
      streamTenantId: tenantId1,
      roles: '["Admin", "TenantAdmin"]',
    });
    await insertMembershipWithEvent({
      id: aggId2,
      userId,
      payloadTenantId: tenantId2,
      streamTenantId: tenantId2,
      roles: '["User"]',
    });

    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships).toHaveLength(2);

    const m1 = memberships.find((m) => m.tenantId === tenantId1);
    expect(m1?.roles).toEqual(["Admin", "TenantAdmin"]);

    const m2 = memberships.find((m) => m.tenantId === tenantId2);
    expect(m2?.roles).toEqual(["User"]);
  });

  test("stream-tenant != payload-tenant wird korrekt ausgewiesen (Driver-Bug)", async () => {
    // Reproduziert den publicstatus-Driver-Fall: seedTenantMembership
    // wurde mit by=systemAdmin aufgerufen → executor.tenantId=
    // SYSTEM_TENANT_ID landet als events.tenant_id, während payload.
    // tenantId der target-Tenant ist. Die beiden divergieren.
    const userId = "01900000-0000-7000-8000-000000000001";
    const aggId = "00000000-0000-4000-8000-0000000000b1";
    const payloadTenant = "00000000-0000-4000-8000-000000000042";
    const streamTenant = "00000000-0000-4000-8000-000000000001"; // SYSTEM_TENANT-Stil
    await insertMembershipWithEvent({
      id: aggId,
      userId,
      payloadTenantId: payloadTenant,
      streamTenantId: streamTenant,
      roles: '["Admin"]',
    });

    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const [m] = await ctx.findMembershipsOfUser(userId);
    expect(m).toEqual({
      userId,
      tenantId: payloadTenant,
      streamTenantId: streamTenant,
      roles: ["Admin"],
    });
  });

  test("malformed roles-JSON → leeres Array (defensive, no throw)", async () => {
    // Defensive: wenn ein corrupted row kommt, soll der Seed nicht
    // explodieren — kann selbst entscheiden was zu tun ist.
    const userId = "01900000-0000-7000-8000-000000000002";
    const aggId = "00000000-0000-4000-8000-0000000000c1";
    const tenantId = "00000000-0000-4000-8000-000000000003";
    await insertMembershipWithEvent({
      id: aggId,
      userId,
      payloadTenantId: tenantId,
      streamTenantId: tenantId,
      roles: "not-json",
    });
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships[0]?.roles).toEqual([]);
  });

  test("liefert leere Liste bei userId ohne memberships", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser("01900000-0000-7000-8000-000000000099");
    expect(memberships).toEqual([]);
  });

  test("membership ohne v1-Event wird vom INNER JOIN ausgefiltert (Drift-Detection)", async () => {
    // Schutz vor Data-Drift: read-row ohne event-row ist kein legitimer
    // Zustand für ein ES-Aggregate. Statt einer Half-Row zurückzugeben
    // verschwindet die Row aus dem Result — Seed-Author sieht "0 memberships"
    // statt einer mit fehlendem stream-tenant zu arbeiten und schwer
    // diagnostizierbare version_conflict-Errors zu produzieren.
    const userId = "01900000-0000-7000-8000-000000000003";
    await testDb.db.execute(sql`
      INSERT INTO read_tenant_memberships (id, user_id, tenant_id, roles) VALUES
        ('00000000-0000-4000-8000-0000000000d1'::uuid, ${userId},
         '00000000-0000-4000-8000-000000000005'::uuid, '["Admin"]')
    `);
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships).toEqual([]);
  });
});

describe("SeedMigrationContext.findTenants (integration)", () => {
  test("returnt alle Tenants sortiert nach inserted_at", async () => {
    await testDb.db.execute(sql`
      INSERT INTO read_tenants (id, name, tenant_key, inserted_at) VALUES
        ('00000000-0000-4000-8000-000000000002'::uuid, 'Beta',  'beta',  '2026-01-02'),
        ('00000000-0000-4000-8000-000000000001'::uuid, 'Alpha', 'alpha', '2026-01-01')
    `);
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const tenants = await ctx.findTenants();
    expect(tenants.map((t) => t.tenantKey)).toEqual(["alpha", "beta"]); // ORDER BY inserted_at ASC
    expect(tenants[0]).toMatchObject({ name: "Alpha", tenantKey: "alpha" });
  });
});

// --- skippable + env-flag (Integration) ---------------------------------

describe("runPendingSeedMigrations: skippable + env-flag (integration)", () => {
  test("skippable=true + env-flag='1' → kein Marker in DB", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-skip-via-env.ts",
        content: `
          export default {
            description: "skippable seed",
            skippable: true,
            run: async () => {
              throw new Error("MUST NOT BE CALLED — env-flag should skip me");
            },
          };
        `,
      },
    ]);
    const envKey = "KUMIKO_SKIP_ES_OPS_2026_05_20_SKIP_VIA_ENV";
    process.env[envKey] = "1";
    try {
      const r = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: makeMockDispatcher() as never, dbRunner }),
        logger: () => {},
      });
      expect(r.appliedIds).toEqual([]);
      expect(r.skippedIds).toEqual(["2026-05-20-skip-via-env"]);

      // Kritisch: KEIN Marker — beim nächsten Boot ohne env-flag würde
      // der Seed dann tatsächlich laufen.
      const markers = await testDb.db.select().from(esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      delete process.env[envKey];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skippable=true OHNE env-flag → läuft normal", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-skippable-but-no-flag.ts",
        content: `
          export default {
            description: "skippable seed, kein env-flag gesetzt",
            skippable: true,
            run: async () => {},
          };
        `,
      },
    ]);
    try {
      const r = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: makeMockDispatcher() as never, dbRunner }),
        logger: () => {},
      });
      expect(r.appliedIds).toEqual(["2026-05-20-skippable-but-no-flag"]);
      expect(r.skippedIds).toEqual([]);

      const markers = await testDb.db.select().from(esOperationsTable);
      expect(markers).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- ctx.db Escape-Hatch (Integration) -----------------------------------

describe("SeedMigrationContext.db (escape-hatch, integration)", () => {
  test("ctx.db kann für eigene Lookups genutzt werden (read-only)", async () => {
    await testDb.db.execute(sql`
      INSERT INTO read_tenants (id, name, tenant_key) VALUES
        ('00000000-0000-4000-8000-000000000007'::uuid, 'Lucky', 'lucky')
    `);
    const ctx = createSeedMigrationContext({
      dispatcher: makeMockDispatcher() as never,
      dbRunner: testDb.db,
    });
    const rows = (await ctx.db.execute(
      sql`SELECT name FROM read_tenants WHERE tenant_key = 'lucky'`,
    )) as unknown as readonly { name: string }[];
    expect(rows[0]?.name).toBe("Lucky");
  });
});

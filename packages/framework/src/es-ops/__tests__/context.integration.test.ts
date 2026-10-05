// @no-server-stack: testet die SeedMigrationContext-Read-Helper (nur ctx.db);
// der feature-lose Dispatcher wird nur zum Bauen des Context gebraucht, kein
// HTTP-Pfad.
//
// Integration-Tests für SeedMigrationContext-Read-Helpers + skippable-
// integration. Verifizieren dass:
// - findUserByEmail liest read_users korrekt (typed result-cast)
// - findMembershipsOfUser parst JSON-encoded roles korrekt
// - findTenants returnt sorted-by-inserted_at
// - skippable + env-flag: kein marker geschrieben (gegen real-DB)
// - findTemplateResources filtert per Bind-Parameter, defaultet auf den
//   System-Tenant und liefert [] ohne template-Tabelle
// - ctx.db ist DbRunner (Escape-Hatch für direct-reads)
//
// Schema-stubs sind raw CREATE TABLE, weil das vollständige user/tenant-
// Feature in den Tests zu schwer wäre — wir testen nur den Read-Helper-
// Layer, nicht die volle Event-Store-Pipeline.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db.js";
import { asRawClient, selectMany } from "../../db/query.js";
import { createRegistry, SYSTEM_TENANT_ID } from "../../engine/index.js";
import { createDispatcher, type Dispatcher } from "../../pipeline/index.js";
import { testTenantId } from "../../stack/test-users.js";
import { ensureTemporalPolyfill } from "../../time/polyfill.js";
import { createSeedMigrationContext } from "../context.js";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema.js";
import { runPendingSeedMigrations } from "../runner.js";

let testDb: BunTestDb;
// Real (feature-less) dispatcher — these tests exercise the read-helper layer
// (findUserByEmail/…) which only touches ctx.db; the context builder still
// requires a dispatcher, so a real one with no handlers is wired here instead
// of a fabricated stub. systemWriteAs is never called in this suite.
let dispatcher: Dispatcher;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEsOperationsTable(testDb.db);

  const registry = createRegistry([]);
  dispatcher = createDispatcher(registry, {
    db: testDb.db,
    redis: undefined as never,
    entityCache: undefined as never,
    registry,
  });

  // Minimal-Schema-Stubs für die 3 Read-Tabellen die context.ts liest.
  // Spalten matchen production (siehe Sysadmin-Stream-Tenant-Bug Memory).
  await asRawClient(testDb.db).unsafe(`
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
      key    text NOT NULL,
      inserted_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`
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
  await asRawClient(testDb.db).unsafe(
    `
    INSERT INTO read_tenant_memberships (id, user_id, tenant_id, roles)
    VALUES ($1::uuid, $2, $3::uuid, $4)
  `,
    [args.id, args.userId, args.payloadTenantId, args.roles],
  );
  await asRawClient(testDb.db).unsafe(
    `
    INSERT INTO kumiko_events
      (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
    VALUES
      ($1::uuid, 'tenant-membership', $2::uuid, 1,
       'tenant-membership.created', '{}'::jsonb, '{"userId":"system"}'::jsonb, 'system')
  `,
    [args.id, args.streamTenantId],
  );
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
    await asRawClient(testDb.db).unsafe(
      `
      INSERT INTO read_users (id, email, tenant_id)
      VALUES ($1::uuid, 'admin@example.com', $2::uuid)
    `,
      [userId, tenantId],
    );

    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const found = await ctx.findUserByEmail("admin@example.com");
    expect(found).toEqual({ id: userId, email: "admin@example.com", tenantId });
  });

  test("liefert null bei unknown email (kein throw)", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher,
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
      dispatcher,
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
      dispatcher,
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
      dispatcher,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships[0]?.roles).toEqual([]);
  });

  test("liefert leere Liste bei userId ohne memberships", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher,
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
    await asRawClient(testDb.db).unsafe(
      `
      INSERT INTO read_tenant_memberships (id, user_id, tenant_id, roles) VALUES
        ('00000000-0000-4000-8000-0000000000d1'::uuid, $1,
         '00000000-0000-4000-8000-000000000005'::uuid, '["Admin"]')
    `,
      [userId],
    );
    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships).toEqual([]);
  });
});

describe("SeedMigrationContext.findTenants (integration)", () => {
  test("returnt alle Tenants sortiert nach inserted_at", async () => {
    await asRawClient(testDb.db).unsafe(`
      INSERT INTO read_tenants (id, name, key, inserted_at) VALUES
        ('00000000-0000-4000-8000-000000000002'::uuid, 'Beta',  'beta',  '2026-01-02'),
        ('00000000-0000-4000-8000-000000000001'::uuid, 'Alpha', 'alpha', '2026-01-01')
    `);
    const ctx = createSeedMigrationContext({
      dispatcher,
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
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      expect(r.appliedIds).toEqual([]);
      expect(r.skippedIds).toEqual(["2026-05-20-skip-via-env"]);

      // Kritisch: KEIN Marker — beim nächsten Boot ohne env-flag würde
      // der Seed dann tatsächlich laufen.
      const markers = await selectMany(testDb.db, esOperationsTable);
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
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      expect(r.appliedIds).toEqual(["2026-05-20-skippable-but-no-flag"]);
      expect(r.skippedIds).toEqual([]);

      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- ctx.db Escape-Hatch (Integration) -----------------------------------

describe("SeedMigrationContext.db (escape-hatch, integration)", () => {
  test("ctx.db kann für eigene Lookups genutzt werden (read-only)", async () => {
    await asRawClient(testDb.db).unsafe(`
      INSERT INTO read_tenants (id, name, key) VALUES
        ('00000000-0000-4000-8000-000000000007'::uuid, 'Lucky', 'lucky')
    `);
    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const rows = (await asRawClient(ctx.db).unsafe(
      `SELECT name FROM read_tenants WHERE key = 'lucky'`,
    )) as unknown as readonly { name: string }[];
    expect(rows[0]?.name).toBe("Lucky");
  });
});

describe("SeedMigrationContext.findTemplateResources (integration)", () => {
  const OTHER_TENANT_ID = testTenantId(99);
  const ids = {
    welcomeDe: "00000000-0000-4000-8000-0000000000b1",
    welcomeEn: "00000000-0000-4000-8000-0000000000b2",
    incident: "00000000-0000-4000-8000-0000000000b3",
    foreign: "00000000-0000-4000-8000-0000000000b4",
  };

  function buildContext() {
    return createSeedMigrationContext({ dispatcher, dbRunner: testDb.db });
  }

  async function insertTemplate(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly slug: string;
    readonly kind: string;
    readonly locale: string;
    readonly status: string;
  }): Promise<void> {
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO read_template_resources (id, tenant_id, slug, kind, locale, status)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
      [args.id, args.tenantId, args.slug, args.kind, args.locale, args.status],
    );
  }

  async function createTemplateTable(): Promise<void> {
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE read_template_resources (
        id        uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        slug      text NOT NULL,
        kind      text NOT NULL,
        locale    text NOT NULL,
        status    text NOT NULL
      )
    `);
  }

  async function dropTemplateTable(): Promise<void> {
    await asRawClient(testDb.db).unsafe("DROP TABLE IF EXISTS read_template_resources");
  }

  test("returns [] when the template table does not exist", async () => {
    await dropTemplateTable();
    expect(await buildContext().findTemplateResources()).toEqual([]);
  });

  describe("with the table present", () => {
    beforeEach(async () => {
      await dropTemplateTable();
      await createTemplateTable();
      await insertTemplate({
        id: ids.welcomeEn,
        tenantId: SYSTEM_TENANT_ID,
        slug: "welcome",
        kind: "notification",
        locale: "en",
        status: "active",
      });
      await insertTemplate({
        id: ids.welcomeDe,
        tenantId: SYSTEM_TENANT_ID,
        slug: "welcome",
        kind: "notification",
        locale: "de",
        status: "active",
      });
      await insertTemplate({
        id: ids.incident,
        tenantId: SYSTEM_TENANT_ID,
        slug: "incident",
        kind: "text-block",
        locale: "en",
        status: "archived",
      });
      await insertTemplate({
        id: ids.foreign,
        tenantId: OTHER_TENANT_ID,
        slug: "welcome",
        kind: "notification",
        locale: "en",
        status: "active",
      });
    });

    afterAll(dropTemplateTable);

    test("defaults to the system tenant and orders by slug, locale", async () => {
      const rows = await buildContext().findTemplateResources();
      expect(rows.map((r) => `${r.slug}/${r.locale}`)).toEqual([
        "incident/en",
        "welcome/de",
        "welcome/en",
      ]);
      expect(rows.every((r) => r.tenantId === SYSTEM_TENANT_ID)).toBe(true);
    });

    test("filters by slug, kind, status and locale", async () => {
      const ctx = buildContext();
      expect(await ctx.findTemplateResources({ slug: "welcome", locale: "de" })).toEqual([
        {
          id: ids.welcomeDe,
          tenantId: SYSTEM_TENANT_ID,
          slug: "welcome",
          kind: "notification",
          locale: "de",
          status: "active",
        },
      ]);
      const archived = await ctx.findTemplateResources({ kind: "text-block", status: "archived" });
      expect(archived.map((r) => r.id)).toEqual([ids.incident]);
    });

    test("a filter that matches nothing returns []", async () => {
      expect(
        await buildContext().findTemplateResources({ slug: "welcome", status: "archived" }),
      ).toEqual([]);
    });

    test("tenantId selects another tenant's rows", async () => {
      const rows = await buildContext().findTemplateResources({
        tenantId: OTHER_TENANT_ID,
      });
      expect(rows.map((r) => r.id)).toEqual([ids.foreign]);
    });

    test("filter values are bound parameters, not SQL", async () => {
      expect(await buildContext().findTemplateResources({ slug: "welcome' OR '1'='1" })).toEqual(
        [],
      );
    });
  });
});

// @no-server-stack: covers the SeedMigrationContext read helpers (ctx.db only); the
// feature-less dispatcher is only needed to build the context, there is no HTTP path.
//
// The user/tenant entities live in bundled-features, which the framework package cannot
// import, so their read tables are raw stubs. Memberships use a mirror entity so the table
// is derived from an entity definition and rows are seeded through the entity table.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configurePiiSubjectKms,
  encryptPiiValueForSubject,
  InMemoryKmsAdapter,
} from "../../crypto/index.ts";
import { resetPiiSubjectKmsForTests } from "../../crypto/pii-field-encryption.ts";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { buildEntityTable } from "../../db/index.ts";
import { asRawClient, insertOne, selectMany } from "../../db/query.ts";
import { unsafeCreateEntityTable } from "../../db/table-push.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  SYSTEM_TENANT_ID,
} from "../../engine/index.ts";
import { append } from "../../event-store/index.ts";
import { withExecutorManagedWritesForTests } from "../../internal/testing.ts";
import { createDispatcher, type Dispatcher } from "../../pipeline/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createSeedMigrationContext } from "../context.ts";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema.ts";
import { runPendingSeedMigrations } from "../runner.ts";

const membershipEntity = createEntity({
  table: "read_tenant_memberships",
  fields: {
    userId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    roles: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});
const membershipsTable = buildEntityTable("tenant-membership", membershipEntity);

async function seedMembershipRow(args: {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: string;
}): Promise<void> {
  await insertOne(withExecutorManagedWritesForTests(testDb.db), membershipsTable, args);
}

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

  // Minimal schema stubs for the read tables consumed by context.ts.
  // Columns match the production schema.
  await asRawClient(testDb.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_users (
      id          uuid PRIMARY KEY,
      email       text NOT NULL,
      tenant_id   uuid NOT NULL
    );
    CREATE TABLE IF NOT EXISTS read_tenants (
      id            uuid PRIMARY KEY,
      name          text NOT NULL,
      key    text NOT NULL,
      inserted_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
  await unsafeCreateEntityTable(testDb.db, membershipEntity, "tenant-membership");
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
  await seedMembershipRow({
    id: args.id,
    userId: args.userId,
    tenantId: args.payloadTenantId,
    roles: args.roles,
  });
  await append(testDb.db, {
    aggregateId: args.id,
    aggregateType: "tenant-membership",
    tenantId: args.streamTenantId,
    expectedVersion: 0,
    type: "tenant-membership.created",
    payload: {},
    metadata: { userId: "system" },
  });
}

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-ctx-integ-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

// --- Read-Helpers --------------------------------------------------------

describe("SeedMigrationContext.findUserByEmail (integration)", () => {
  test("correctly reads an existing user row and maps tenant_id → tenantId", async () => {
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

  test("returns null for unknown email (does not throw)", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const found = await ctx.findUserByEmail("does-not-exist@example.com");
    expect(found).toBeNull();
  });
});

describe("SeedMigrationContext.findMembershipsOfUser (integration)", () => {
  test("parses the JSON-encoded roles column into string[]", async () => {
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

  test("correctly reports stream-tenant != payload-tenant (Driver-Bug)", async () => {
    // Reproduces the publicstatus driver case: seedTenantMembership was called
    // with by=systemAdmin, so executor.tenantId=
    // SYSTEM_TENANT_ID is stored as events.tenant_id, while payload.tenantId
    // is the target tenant. The two values diverge.
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
    // Defensive handling: if a corrupted row is returned, the seed must not
    // fail; the caller can decide how to proceed.
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

  test("returns an empty list for a userId with no memberships", async () => {
    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser("01900000-0000-7000-8000-000000000099");
    expect(memberships).toEqual([]);
  });

  test("membership without a v1 event is filtered out by INNER JOIN (drift detection)", async () => {
    // Prevents data drift: a read row without an event row is not a valid
    // ES aggregate state. The row is excluded instead of returning a partial
    // result with a missing stream tenant, which would cause difficult-to-
    // diagnose version_conflict errors.
    const userId = "01900000-0000-7000-8000-000000000003";
    await seedMembershipRow({
      id: "00000000-0000-4000-8000-0000000000d1",
      userId,
      tenantId: "00000000-0000-4000-8000-000000000005",
      roles: '["Admin"]',
    });
    const ctx = createSeedMigrationContext({
      dispatcher,
      dbRunner: testDb.db,
    });
    const memberships = await ctx.findMembershipsOfUser(userId);
    expect(memberships).toEqual([]);
  });
});

describe("SeedMigrationContext.findTenants (integration)", () => {
  test("returns all tenants sorted by inserted_at", async () => {
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

describe("SeedMigrationContext.findTenants under an active PII KMS (integration)", () => {
  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("returns the plaintext name of a tenant stored as ciphertext", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const tenantId = "00000000-0000-4000-8000-000000000003";
    const ciphertext = await encryptPiiValueForSubject(
      kms,
      { kind: "tenant", tenantId },
      "Gamma GmbH",
      { requestId: "test" },
      "name",
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO read_tenants (id, name, key) VALUES ('${tenantId}'::uuid, '${ciphertext}', 'gamma')`,
    );
    const ctx = createSeedMigrationContext({ dispatcher, dbRunner: testDb.db });

    const tenants = await ctx.findTenants();

    expect(tenants).toMatchObject([{ name: "Gamma GmbH", tenantKey: "gamma" }]);
  });
});

// --- skippable + env-flag (Integration) ---------------------------------

describe("runPendingSeedMigrations: skippable + env-flag (integration)", () => {
  test("skippable=true + env-flag='1' → no marker in DB", async () => {
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

      // Critical: no marker is written, so the seed will run on the next boot
      // if the environment flag is absent.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      delete process.env[envKey];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skippable=true WITHOUT env-flag → runs normally", async () => {
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
  test("ctx.db can be used for custom lookups (read-only)", async () => {
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

  // framework cannot import template-resolver; the real-schema test lives in
  // bundled-features (template-resolver/__tests__/seed-context-templates).
  // Like the real table, this one has no is_deleted column.
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
        kind: "ai-prompt",
        locale: "en",
        status: "active",
      });
      await insertTemplate({
        id: ids.welcomeDe,
        tenantId: SYSTEM_TENANT_ID,
        slug: "welcome",
        kind: "ai-prompt",
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
        kind: "ai-prompt",
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
          kind: "ai-prompt",
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

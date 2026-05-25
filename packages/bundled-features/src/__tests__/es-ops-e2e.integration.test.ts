// @no-server-stack: seed-runner ist boot-time-Code, kein HTTP-route.
// setupTestStack/buildServer würden eine Hono-app aufziehen die wir nicht
// brauchen — der seed-runner ruft dispatcher.write direkt vor dem
// entrypoint.start(). Pattern matched die echte run-prod-app.ts-Integration
// (siehe run-prod-app.ts:632 — createDispatcher mit identical ctx-shape
// inline gebaut bevor entrypoint.start()).
//
// End-to-End-Integration-Test gegen real-Stack (Phase 1.5 / A3).
// Catched die Bug-Klassen die runner.integration.ts mit Mock-Dispatcher
// NICHT abdeckt:
//   - handler-QN-Resolution (Bug 3)
//   - access-rule-realität (Bug 4)
//   - tenantId-stream-matching (Bug 5)
//
// Setup: createTestDb + tenant/config-features. Echtes Aggregate im
// Demo-Tenant via TenantHandlers.addMember. Seed-migration ruft
// updateMemberRoles auf — MUSS tenantIdOverride nutzen sonst
// version_conflict.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEsOperationsTable,
  createSeedMigrationContext,
  esOperationsTable,
  runPendingSeedMigrations,
} from "@cosmicdrift/kumiko-framework/es-ops";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createDispatcher, type Dispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../config/feature";
import { createConfigResolver } from "../config/resolver";
import { configValuesTable } from "../config/table";
import { TenantHandlers } from "../tenant/constants";
import { createTenantFeature } from "../tenant/feature";
import { tenantMembershipsTable } from "../tenant/membership-table";
import { tenantEntity } from "../tenant/schema/tenant";

let testDb: TestDb;
let dispatcher: Dispatcher;
let registry: ReturnType<typeof createRegistry>;

const systemAdmin = TestUsers.systemAdmin;
// Demo-Tenant — NICHT SYSTEM_TENANT. Echter App-Realität (publicstatus
// hat seine Memberships in Demo-Tenants `...0001` / `...0002`).
const demoTenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
const adminUserId = "01900000-0000-7000-8000-000000000aaa";

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, tenantEntity);
  await unsafePushTables(testDb.db, { tenantMembershipsTable, configValuesTable });
  await createEventsTable(testDb.db);
  await createEsOperationsTable(testDb.db);

  registry = createRegistry([createConfigFeature(), createTenantFeature()]);
  const resolver = createConfigResolver();
  dispatcher = createDispatcher(registry, {
    db: testDb.db,
    redis: undefined as never,
    entityCache: undefined as never,
    registry,
    configResolver: resolver,
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`
    TRUNCATE kumiko_es_operations, kumiko_events, read_tenants, read_tenant_memberships
  `);
});

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-e2e-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

describe("es-ops Phase 1.5 — E2E gegen real-Stack", () => {
  test("seed-migration kann updateMemberRoles auf aggregate in Demo-Tenant aufrufen (tenantIdOverride)", async () => {
    // Setup-Stage: tenant + membership ES-konform via Handler erstellen.
    // event lebt im demoTenant-stream.
    const tenantRes = await dispatcher.write(
      TenantHandlers.create,
      { id: demoTenantId, key: "demo", name: "Demo Tenant" },
      { ...systemAdmin, tenantId: demoTenantId },
    );
    expect(tenantRes.isSuccess).toBe(true);

    const addRes = await dispatcher.write(
      TenantHandlers.addMember,
      { userId: adminUserId, tenantId: demoTenantId, roles: ["Admin"] },
      { ...systemAdmin, tenantId: demoTenantId },
    );
    expect(addRes.isSuccess).toBe(true);

    // Plant: seed migriert die Rolle. KEY: tenantIdOverride = demoTenantId,
    // sonst greift SYSTEM_TENANT_ID-default und write geht in version_conflict.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-21-add-tenant-admin.ts",
        content: `
          export default {
            description: "ergänze TenantAdmin auf admin-membership im demo-tenant",
            run: async (ctx) => {
              const memberships = await ctx.findMembershipsOfUser("${adminUserId}");
              for (const m of memberships) {
                if (m.roles.includes("TenantAdmin")) continue;
                await ctx.systemWriteAs(
                  "tenant:write:update-member-roles",
                  { userId: "${adminUserId}", tenantId: m.tenantId, roles: [...m.roles, "TenantAdmin"] },
                  m.tenantId,  // ← tenantIdOverride (Phase 1.5 API)
                );
              }
            },
          };
        `,
      },
    ]);

    try {
      const result = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      expect(result.appliedIds).toEqual(["2026-05-21-add-tenant-admin"]);

      // Verify (a) marker
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(1);
      expect(markers[0]?.id).toBe("2026-05-21-add-tenant-admin");

      // Verify (b) event in store mit tenant-membership.updated
      const events = (await asRawClient(testDb.db).unsafe(
        `SELECT type, tenant_id::text AS tenant_id FROM kumiko_events ORDER BY id`,
      )) as unknown as readonly { type: string; tenant_id: string }[];
      const updateEvents = events.filter((e) => e.type === "tenant-membership.updated");
      expect(updateEvents).toHaveLength(1);
      expect(updateEvents[0]?.tenant_id).toBe(demoTenantId);

      // Verify (c) read-model aktualisiert
      const memberships = (await asRawClient(testDb.db).unsafe(
        `SELECT roles FROM read_tenant_memberships WHERE user_id = $1`,
        [adminUserId],
      )) as unknown as readonly { roles: string }[];
      expect(JSON.parse(memberships[0]?.roles ?? "[]")).toEqual(["Admin", "TenantAdmin"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seed-migration mit handler-QN-typo fail-t dry-run (vor write)", async () => {
    // Phase 1.5 / A2 — seed-dry-run-validator soll camelCase-typo catchen
    // BEVOR der dispatcher den write versucht.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-21-bad-qn.ts",
        content: `
          export default {
            description: "uses camelCase typo for handler-QN",
            run: async (ctx) => {
              await ctx.systemWriteAs(
                "tenant:write:updateMemberRoles", // ← camelCase typo
                { userId: "x", tenantId: "y", roles: ["z"] },
                "y",
              );
            },
          };
        `,
      },
    ]);
    try {
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          registry, // ← dry-run sieht den typo, wirft mit klarer message
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(
        // Phase 1.5 / A2 — Dry-Run-validator wirft mit der spezifischen
        // Phrase "dry-run found ... unknown handler-QN" + dem qn im body.
        /dry-run found.*unknown handler-QN/,
      );

      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

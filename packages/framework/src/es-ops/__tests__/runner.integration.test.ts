// @no-server-stack: the seed runner is boot-time code — dispatcher.write runs
// immediately before entrypoint.start() (run-prod-app pattern), so no HTTP route is needed.
//
// Integration test against real Postgres and the real dispatcher. Verifies:
// - The marker is written to kumiko_es_operations after success
// - Idempotency: the second boot skips applied seeds
// - Transaction rollback on failure (no marker is written)
// - systemWriteAs reaches the real handler in the SYSTEM_TENANT stream
// - WriteResult{isSuccess:false} aborts the run (no marker is written)
//
// createDispatcher is used instead of setupTestStack/HTTP because the seed runner is
// boot-time code that calls dispatcher.write immediately before entrypoint.start()
// (see run-prod-app.ts), not an HTTP route. A real esopstest feature provides the
// handlers targeted by the seeds; nothing is mocked.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { asRawClient, insertOne, selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "../../engine/index.ts";
import { VersionConflictError } from "../../errors/index.ts";
import { createDispatcher, type Dispatcher } from "../../pipeline/index.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createSeedMigrationContext } from "../context.ts";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema.ts";
import { runPendingSeedMigrations } from "../runner.ts";

// Minimal real feature whose handlers the seeds target. probe:create emits a
// real event through the real dispatcher; probe:fail returns a failed
// WriteResult (via a thrown VersionConflictError) so the isSuccess:false path
// is exercised against the production write-pipeline, not a stubbed return.
const probeEntity = createEntity({
  table: "read_esops_probes",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const probeTable = buildEntityTable("esops-probe", probeEntity);
const probeExecutor = createEventStoreExecutor(probeTable, probeEntity, {
  entityName: "esops-probe",
});

const seedTestFeature = defineFeature("esopstest", (r) => {
  r.entity({ name: "esops-probe", ...probeEntity });
  // openToAll: reachable by the seed's system user (roles ["system"]) —
  // hasAccess has no system-bypass, so a role-gated handler would be denied.
  r.writeHandler({
    name: "probe:create",
    schema: z.object({ label: z.string().min(1) }),
    handler: async (event, ctx) => probeExecutor.create(event.payload, event.user, ctx.db),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.writeHandler({
    name: "probe:fail",
    schema: z.object({ label: z.string() }),
    handler: async () => {
      throw new VersionConflictError({
        entityId: "esops-probe",
        expectedVersion: 1,
        currentVersion: 2,
      });
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  // Role-gated handler (no openToAll): the bare system actor has no bypass
  // for explicit role gates — only systemWriteAs' extraRoles reaches it.
  r.writeHandler({
    name: "probe:admin-only",
    schema: z.object({ label: z.string().min(1) }),
    handler: async (event, ctx) => probeExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["SystemAdmin"] },
  });
});

let testDb: TestDb;
let dispatcher: Dispatcher;
let registry: ReturnType<typeof createRegistry>;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEsOperationsTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, probeEntity, "esops-probe");
  registry = createRegistry([seedTestFeature]);
  dispatcher = createDispatcher(registry, {
    db: testDb.db,
    // The seed-migration path uses neither redis nor entityCache — undefined
    // is safe here; the `as never` cast only suppresses the required types.
    redis: undefined as never,
    entityCache: undefined as never,
    registry,
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_es_operations, kumiko_events, read_esops_probes RESTART IDENTITY`,
  );
});

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-integration-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

async function selectEvents(): Promise<readonly { type: string; tenant_id: string }[]> {
  return (await asRawClient(testDb.db).unsafe(
    `SELECT type, tenant_id::text AS tenant_id FROM kumiko_events ORDER BY id`,
  )) as unknown as readonly { type: string; tenant_id: string }[];
}

describe("runPendingSeedMigrations (integration)", () => {
  test("first run: applies pending + writes marker, second run: skips applied", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-noop.ts",
        content: `
          export default {
            description: "no-op seed for integration test",
            run: async () => {},
          };
        `,
      },
    ]);
    try {
      // First run: pending → applied
      const r1 = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      expect(r1.appliedIds).toEqual(["2026-05-20-noop"]);

      // Marker landed
      const markers1 = await selectMany(testDb.db, esOperationsTable);
      expect(markers1).toHaveLength(1);
      expect(markers1[0]?.id).toBe("2026-05-20-noop");
      expect(markers1[0]?.operationType).toBe("seed-migration");
      expect(markers1[0]?.appliedBy).toBe("boot");

      // Second run: already applied → skipped, no new markers
      const r2 = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      expect(r2.appliedIds).toEqual([]);
      const markers2 = await selectMany(testDb.db, esOperationsTable);
      expect(markers2).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seed throws → Tx rollback, kein Marker geschrieben", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-fails.ts",
        content: `
          export default {
            description: "intentional fail",
            run: async () => { throw new Error("boom"); },
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
          registry,
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/boom/);

      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("systemWriteAs leitet zum echten Handler im SYSTEM_TENANT-Stream durch", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-uses-dispatcher.ts",
        content: `
          export default {
            description: "calls a write-handler",
            run: async (ctx) => {
              await ctx.systemWriteAs("esopstest:write:probe:create", { label: "bar" });
            },
          };
        `,
      },
    ]);
    try {
      await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });

      // Real event landed in the SYSTEM_TENANT stream → proves the write
      // routed through the dispatcher AND ran as the system user (no
      // tenantIdOverride → createSystemUser(SYSTEM_TENANT_ID)).
      const events = await selectEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("esops-probe.created");
      expect(events[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("systemWriteAs ohne extraRoles → access_denied gegen rollen-gated Handler, mit extraRoles → durch", async () => {
    const denyDir = makeTempSeedsDir([
      {
        name: "2026-05-20-denied.ts",
        content: `
          export default {
            description: "no extraRoles against a role-gated handler",
            run: async (ctx) => {
              await ctx.systemWriteAs("esopstest:write:probe:admin-only", { label: "denied" });
            },
          };
        `,
      },
    ]);
    try {
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: denyDir,
          appliedBy: "boot",
          registry,
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/access_denied/);
      expect(await selectEvents()).toHaveLength(0);
    } finally {
      rmSync(denyDir, { recursive: true, force: true });
    }

    const allowDir = makeTempSeedsDir([
      {
        name: "2026-05-20-allowed.ts",
        content: `
          export default {
            description: "extraRoles reaches a role-gated handler",
            run: async (ctx) => {
              await ctx.systemWriteAs(
                "esopstest:write:probe:admin-only",
                { label: "allowed" },
                undefined,
                ["SystemAdmin"],
              );
            },
          };
        `,
      },
    ]);
    try {
      await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: allowDir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });
      const events = await selectEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("esops-probe.created");
      expect(events[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);
    } finally {
      rmSync(allowDir, { recursive: true, force: true });
    }
  });

  test("WriteResult{isSuccess:false} → throw + Marker NICHT geschrieben", async () => {
    // Without this guarantee, a silently failed Write would mark the seed as
    // "applied", preventing a retry on the next boot and leaving database drift
    // undetected.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-write-fails.ts",
        content: `
          export default {
            description: "tries a handler that returns isSuccess:false",
            run: async (ctx) => {
              await ctx.systemWriteAs("esopstest:write:probe:fail", { label: "bar" });
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
          registry,
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/version_conflict/);

      // No marker — the seed would be retried on the next boot, and the failed
      // Write left no event behind.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
      expect(await selectEvents()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("documented limitation: dispatcher-writes vor throw bleiben committed (idempotency-Pflicht für seeds)", async () => {
    // Documented limitation: systemWriteAs runs through the app dispatcher,
    // which manages its own transaction (runBatch opens a separate transaction
    // on context.db; the runner's outer transaction is not passed through).
    // The runner transaction therefore protects only the marker insert and
    // direct dbRunner reads, not dispatcher writes. Seeds must be idempotent.
    //
    // Test: dispatcher.write commits successfully once, then the seed throws.
    // Expected:
    //   - the event is committed and survives the runner rollback
    //   - no marker is written because run is rolled back
    //   - a retry on the next boot must be idempotent, or it will create a
    //     duplicate — this is the documented requirement.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-write-then-throw.ts",
        content: `
          export default {
            description: "writes successfully then throws (idempotency test)",
            run: async (ctx) => {
              await ctx.systemWriteAs("esopstest:write:probe:create", { label: "step1" });
              throw new Error("post-write failure");
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
          registry,
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/post-write failure/);

      // The event remains committed because the dispatcher transaction is
      // isolated from the runner transaction.
      const events = await selectEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("esops-probe.created");
      // No marker is written, so the migration runs again on the next boot.
      // A non-idempotent write would create a duplicate.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applied-set filter: entries already in kumiko_es_operations werden geskipped", async () => {
    // Covers the loadAppliedIds filter (pending = files \ applied).
    // The pg_advisory_xact_lock and inner-transaction re-check provide a second
    // defense against parallel-pod races between loadAppliedIds and the
    // per-migration transaction. This race is not reproducible in a single-
    // process test without additional lock coordination, so this test verifies
    // only the upper filter layer, which is the common path.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-race.ts",
        content: `
          export default {
            description: "race-test",
            run: async () => {
              throw new Error("MUST NOT BE CALLED — re-check should skip");
            },
          };
        `,
      },
    ]);
    try {
      // Pre-seed a marker as if a parallel pod had already completed.
      await insertOne(testDb.db, esOperationsTable, {
        id: "2026-05-20-race",
        operationType: "seed-migration",
        durationMs: 42,
        appliedBy: "boot",
        notes: "applied by simulated parallel-pod",
      });

      // This would normally be classified as pending (loadAppliedIds reads
      // BEFORE the transaction), so the re-check inside the transaction must
      // catch it. If the re-check works, `run()` is not called (no event, no
      // throw).
      await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        registry,
        createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
        logger: () => {},
      });

      expect(await selectEvents()).toHaveLength(0);
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(1); // only the pre-seeded marker
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("multiple seeds: apply in chronological order, halt on first failure", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-19-first.ts",
        content: `export default { description: "first", run: async () => {} };`,
      },
      {
        name: "2026-05-20-fails.ts",
        content: `export default { description: "fails", run: async () => { throw new Error("stop here"); } };`,
      },
      {
        name: "2026-05-21-never.ts",
        content: `export default { description: "never reached", run: async () => {} };`,
      },
    ]);
    try {
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          registry,
          createContext: (dbRunner) => createSeedMigrationContext({ dispatcher, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/stop here/);

      // Only first has a marker — fails threw, and never was attempted.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers.map((m) => m.id)).toEqual(["2026-05-19-first"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

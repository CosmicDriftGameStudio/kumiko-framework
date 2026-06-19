// @no-server-stack: seed-runner ist boot-time-Code — dispatcher.write läuft
// direkt vor entrypoint.start() (run-prod-app-Pattern), kein HTTP-route nötig.
//
// Integration-Test gegen echtes Postgres + echten Dispatcher. Verifiziert:
// - Marker landet in kumiko_es_operations nach Erfolg
// - Idempotency: zweiter Boot skipped applied seeds
// - Tx-Rollback bei Failure (kein Marker geschrieben)
// - systemWriteAs leitet zum echten Handler im SYSTEM_TENANT-Stream durch
// - WriteResult{isSuccess:false} bricht den Run ab (kein Marker)
//
// createDispatcher statt setupTestStack/HTTP: der seed-runner ist boot-time-
// Code, das dispatcher.write direkt vor entrypoint.start() ruft (siehe
// run-prod-app.ts) — kein HTTP-route. Ein echtes esopstest-Feature liefert die
// Handler, die die Seeds adressieren; nichts wird gemockt.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, insertOne, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "../../engine";
import { VersionConflictError } from "../../errors";
import { createEventsTable } from "../../event-store";
import { createDispatcher, type Dispatcher } from "../../pipeline";
import { createTestDb, type TestDb, unsafeCreateEntityTable } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createSeedMigrationContext } from "../context";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema";
import { runPendingSeedMigrations } from "../runner";

// Minimal real feature whose handlers the seeds target. probe:create emits a
// real event through the real dispatcher; probe:fail returns a failed
// WriteResult (via a thrown VersionConflictError) so the isSuccess:false path
// is exercised against the production write-pipeline, not a stubbed return.
const probeEntity = createEntity({
  table: "read_esops_probes",
  fields: { label: createTextField({ required: true }) },
});
const probeTable = buildEntityTable("esops-probe", probeEntity);
const probeExecutor = createEventStoreExecutor(probeTable, probeEntity, {
  entityName: "esops-probe",
});

const seedTestFeature = defineFeature("esopstest", (r) => {
  r.entity("esops-probe", probeEntity);
  // openToAll: reachable by the seed's system user (roles ["system"]) —
  // hasAccess has no system-bypass, so a role-gated handler would be denied.
  r.writeHandler(
    "probe:create",
    z.object({ label: z.string().min(1) }),
    async (event, ctx) => probeExecutor.create(event.payload, event.user, ctx.db),
    { access: { openToAll: true } },
  );
  r.writeHandler(
    "probe:fail",
    z.object({ label: z.string() }),
    async () => {
      throw new VersionConflictError({
        entityId: "esops-probe",
        expectedVersion: 1,
        currentVersion: 2,
      });
    },
    { access: { openToAll: true } },
  );
});

let testDb: TestDb;
let dispatcher: Dispatcher;
let registry: ReturnType<typeof createRegistry>;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  await createEsOperationsTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, probeEntity, "esops-probe");
  registry = createRegistry([seedTestFeature]);
  dispatcher = createDispatcher(registry, {
    db: testDb.db,
    // Der seed-migration-Pfad nutzt weder redis noch entityCache — undefined
    // ist hier safe, der `as never`-Cast unterdrückt nur die required-Typen.
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

  test("WriteResult{isSuccess:false} → throw + Marker NICHT geschrieben", async () => {
    // Critical: ohne diese Garantie würde ein silent-failed Write den Seed
    // als "applied" markieren → beim nächsten Boot kein retry → DB-Drift
    // bleibt unbemerkt.
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

      // Kein Marker — bei nächstem Boot würde der Seed retried. Und der
      // fehlgeschlagene Write hat kein Event hinterlassen.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
      expect(await selectEvents()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("documented limitation: dispatcher-writes vor throw bleiben committed (idempotency-Pflicht für seeds)", async () => {
    // Documents NICHT-Garantie aus dem README: systemWriteAs läuft durch den
    // App-Dispatcher mit eigener tx-Verwaltung (runBatch öffnet eine eigene
    // Transaktion auf context.db, der Runner-outer-tx wird NICHT durchgereicht)
    // — die Runner-Tx schützt NUR den Marker-Insert + direct dbRunner-reads,
    // NICHT die dispatcher-Writes. Daher müssen Seeds idempotent sein.
    //
    // Test: dispatcher.write committet 1× erfolgreich, dann throws der Seed.
    // Expectation:
    //   - das Event ist committed (überlebt den Runner-Rollback)
    //   - kein Marker (run wurde zurückgerollt)
    //   - bei retry beim nächsten Boot muss der Write idempotent sein, sonst
    //     Duplikat — genau die dokumentierte Pflicht.
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

      // Event blieb committed — der dispatcher-tx ist vom runner-tx isoliert.
      const events = await selectEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("esops-probe.created");
      // Marker NICHT gesetzt — retry beim nächsten Boot führt die Migration
      // nochmal aus. Wenn der Write nicht idempotent ist → Duplikat.
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applied-set filter: entries already in kumiko_es_operations werden geskipped", async () => {
    // Test deckt den loadAppliedIds-Filter ab (pending = files \ applied).
    // Der pg_advisory_xact_lock + inner-tx re-check ist eine zweite Defense-
    // Linie für echte parallel-Pod-Races zwischen loadAppliedIds und der
    // pro-Migration Tx — diese Race ist empirisch nicht reproduzierbar in
    // einem Single-Process-Test ohne extra Lock-Coordination. Wir verifizieren
    // hier nur die obere Filter-Schicht (häufigster Pfad).
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
      // Pre-seed marker als wäre ein parallel-Pod schon durch
      await insertOne(testDb.db, esOperationsTable, {
        id: "2026-05-20-race",
        operationType: "seed-migration",
        durationMs: 42,
        appliedBy: "boot",
        notes: "applied by simulated parallel-pod",
      });

      // Würde normalerweise als pending klassifiziert (loadAppliedIds liest
      // BEFORE the tx) — der re-check inside tx muss das catchen. Wenn der
      // re-check funktioniert, läuft `run()` nicht (kein Event, kein Throw).
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
      expect(markers).toHaveLength(1); // nur der pre-seeded
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

      // Nur first hat marker — fails warf, never wurde nie attempted
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers.map((m) => m.id)).toEqual(["2026-05-19-first"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

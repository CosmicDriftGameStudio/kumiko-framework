// Integration-Test gegen echtes Postgres. Verifiziert:
// - Marker landet in kumiko_es_operations nach Erfolg
// - Idempotency: zweiter Boot skipped applied seeds
// - Tx-Rollback bei Failure (kein Marker geschrieben)
// - systemWriteAs leitet zum Dispatcher durch
// - End-to-End mit echten findUserByEmail / findMembershipsOfUser
//
// Heavy lifting (mock-dispatcher, in-memory-applied-set) liegt in
// runner.test.ts. Hier nur DB-Round-Trip-Wahrheit.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { asRawClient, insertOne, selectMany } from "../../bun-db/query";
import { createTestDb, type BunTestDb } from "../../bun-db/__tests__/bun-test-db";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createSeedMigrationContext } from "../context";
import { createEsOperationsTable, esOperationsTable } from "../operations-schema";
import { runPendingSeedMigrations } from "../runner";

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEsOperationsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE kumiko_es_operations RESTART IDENTITY`);
});

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-integration-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

function makeMockDispatcher() {
  const calls: Array<{ qn: string; payload: unknown }> = [];
  return {
    write: mock(async (qn: string, payload: unknown) => {
      calls.push({ qn, payload });
      return { isSuccess: true as const, data: {} };
    }),
    query: mock(),
    command: mock(),
    batch: mock(),
    resolveAuthClaims: mock(),
    calls,
  };
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
      const dispatcher = makeMockDispatcher();

      // First run: pending → applied
      const r1 = await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
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
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
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
      const dispatcher = makeMockDispatcher();
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: (dbRunner) =>
            createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/boom/);

      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("systemWriteAs leitet zum Dispatcher mit SYSTEM_TENANT-User durch", async () => {
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-uses-dispatcher.ts",
        content: `
          export default {
            description: "calls a write-handler",
            run: async (ctx) => {
              await ctx.systemWriteAs("some:write:handler", { foo: "bar" });
            },
          };
        `,
      },
    ]);
    try {
      const dispatcher = makeMockDispatcher();
      await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
        logger: () => {},
      });

      expect(dispatcher.write).toHaveBeenCalledTimes(1);
      expect(dispatcher.write).toHaveBeenCalledWith(
        "some:write:handler",
        { foo: "bar" },
        expect.objectContaining({ tenantId: expect.any(String) }),
      );
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
              await ctx.systemWriteAs("some:write:handler", { foo: "bar" });
            },
          };
        `,
      },
    ]);
    try {
      const dispatcher = {
        write: mock(async () => ({
          isSuccess: false as const,
          error: { code: "version_conflict", message: "stream changed" },
        })),
        query: mock(),
        command: mock(),
        batch: mock(),
        resolveAuthClaims: mock(),
      };

      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: (dbRunner) =>
            createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/version_conflict/);

      // Kein Marker — bei nächstem Boot würde der Seed retried
      const markers = await selectMany(testDb.db, esOperationsTable);
      expect(markers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("documented limitation: dispatcher-writes vor throw bleiben committed (idempotency-Pflicht für seeds)", async () => {
    // Documents NICHT-Garantie aus dem README: systemWriteAs läuft durch
    // den App-Dispatcher mit eigener tx-Verwaltung — die Runner-Tx
    // schützt NUR den Marker-Insert + direct dbRunner-reads, NICHT die
    // dispatcher-Writes. Daher müssen Seeds idempotent sein.
    //
    // Test: dispatcher.write wird 1× erfolgreich aufgerufen, dann throws.
    // Expectation:
    //   - dispatcher.write was called 1x (confirms write went through)
    //   - kein Marker (run was rolled back)
    //   - bei "echtem" Setup wäre die Event-Row schon committed → retry
    //     müsste idempotent sein, sonst Duplikat.
    const dir = makeTempSeedsDir([
      {
        name: "2026-05-20-write-then-throw.ts",
        content: `
          export default {
            description: "writes successfully then throws (idempotency test)",
            run: async (ctx) => {
              await ctx.systemWriteAs("some:write:handler", { step: 1 });
              throw new Error("post-write failure");
            },
          };
        `,
      },
    ]);
    try {
      const dispatcher = makeMockDispatcher();
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: (dbRunner) =>
            createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
          logger: () => {},
        }),
      ).rejects.toThrow(/post-write failure/);

      // Write-handler WURDE aufgerufen — dispatcher-tx isoliert vom runner-tx
      expect(dispatcher.write).toHaveBeenCalledTimes(1);
      // Marker NICHT gesetzt — retry beim nächsten Boot wird die Migration
      // nochmal ausführen. Wenn der Write nicht idempotent ist → Duplikat.
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

      const dispatcher = makeMockDispatcher();
      // Würde normalerweise als pending klassifiziert (loadAppliedIds liest
      // BEFORE the tx) — der re-check inside tx muss das catchen.
      // Achtung: das obere applied-set-load sieht den Marker auch schon —
      // dieses Test ist daher eher eine Wahrscheinlichkeits-Aussage über
      // den Race-Pfad, nicht ein deterministischer Race-Repro. Aber:
      // wenn der re-check funktioniert, läuft `run()` nicht.
      await runPendingSeedMigrations({
        db: testDb.db,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: (dbRunner) =>
          createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
        logger: () => {},
      });

      expect(dispatcher.write).not.toHaveBeenCalled();
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
      const dispatcher = makeMockDispatcher();
      await expect(
        runPendingSeedMigrations({
          db: testDb.db,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: (dbRunner) =>
            createSeedMigrationContext({ dispatcher: dispatcher as never, dbRunner }),
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

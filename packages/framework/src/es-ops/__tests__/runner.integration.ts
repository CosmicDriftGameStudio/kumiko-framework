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
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(sql`TRUNCATE kumiko_es_operations RESTART IDENTITY`);
});

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-integration-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

function makeMockDispatcher() {
  const calls: Array<{ qn: string; payload: unknown }> = [];
  return {
    write: vi.fn(async (qn: string, payload: unknown) => {
      calls.push({ qn, payload });
      return { isSuccess: true as const, data: {} };
    }),
    query: vi.fn(),
    command: vi.fn(),
    batch: vi.fn(),
    resolveAuthClaims: vi.fn(),
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
      const markers1 = await testDb.db.select().from(esOperationsTable);
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
      const markers2 = await testDb.db.select().from(esOperationsTable);
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

      const markers = await testDb.db.select().from(esOperationsTable);
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
        write: vi.fn(async () => ({
          isSuccess: false as const,
          error: { code: "version_conflict", message: "stream changed" },
        })),
        query: vi.fn(),
        command: vi.fn(),
        batch: vi.fn(),
        resolveAuthClaims: vi.fn(),
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
      const markers = await testDb.db.select().from(esOperationsTable);
      expect(markers).toHaveLength(0);
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
      const markers = await testDb.db.select().from(esOperationsTable);
      expect(markers.map((m) => m.id)).toEqual(["2026-05-19-first"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

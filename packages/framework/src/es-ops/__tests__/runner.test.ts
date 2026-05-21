// Unit-Tests für den runner. Heavy lifting (Tx, applied-set-diff,
// dispatcher-call) testen wir gegen Postgres in der integration-test.
// Hier nur die pure-logic-Pfade die kein echtes DB brauchen.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runPendingSeedMigrations } from "../runner";

function makeTempSeedsDir(files: readonly { name: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "es-ops-test-"));
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  return dir;
}

// Minimal DB-Stub — Runner ruft transaction() + select() + insert() +
// execute() auf. execute() liefert ein leeres array für den
// re-check-inside-lock (= "nicht applied, weiter mit Run").
function makeStubDb(initialApplied: readonly string[] = []) {
  const inserts: Array<Record<string, unknown>> = [];
  const applied = new Set(initialApplied);
  const db = {
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      await cb(db);
    },
    select: () => ({
      from: () => ({
        where: async () => Array.from(applied).map((id) => ({ id })),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserts.push(row);
        if (typeof row["id"] === "string") applied.add(row["id"]);
      },
    }),
    // execute: für pg_advisory_xact_lock + re-check. Leere Liste = "nicht
    // applied im Inner-Lock-Scope, weiter mit Run". applied-set check via
    // select() oben wird sowieso schon angewendet.
    execute: async (_q: unknown) => [],
  };
  return { db, inserts, applied };
}

describe("runPendingSeedMigrations", () => {
  test("no seeds dir → no-op", async () => {
    const { db } = makeStubDb();
    const result = await runPendingSeedMigrations({
      db: db as never,
      seedsDir: "/path/does/not/exist",
      appliedBy: "boot",
      createContext: () => ({}) as never,
      logger: () => {},
    });
    expect(result.appliedIds).toEqual([]);
    expect(result.skippedIds).toEqual([]);
  });

  test("listSeedFiles: filtert non-seed Files raus, sortiert chronologisch", async () => {
    const dir = makeTempSeedsDir([
      { name: "2026-05-20-fix-roles.ts", content: makeSeedFile("fix-roles") },
      { name: "2026-05-19-init.ts", content: makeSeedFile("init") },
      { name: "_helper.ts", content: makeSeedFile("helper") }, // _-prefix → skip
      { name: "README.md", content: "" }, // .md → skip
      { name: ".hidden.ts", content: "" }, // dot-prefix → skip
    ]);
    try {
      const { db } = makeStubDb();
      const result = await runPendingSeedMigrations({
        db: db as never,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: () => ({}) as never,
        logger: () => {},
      });
      // Beide gültige seeds laufen, in chronologischer Reihenfolge
      expect(result.appliedIds).toEqual(["2026-05-19-init", "2026-05-20-fix-roles"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skippable + env-flag → skip ohne run", async () => {
    const dir = makeTempSeedsDir([
      { name: "2026-05-20-skip-me.ts", content: makeSeedFile("skip-me", { skippable: true }) },
    ]);
    const envKey = "KUMIKO_SKIP_ES_OPS_2026_05_20_SKIP_ME";
    process.env[envKey] = "1";
    try {
      const { db, inserts } = makeStubDb();
      const result = await runPendingSeedMigrations({
        db: db as never,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: () => ({}) as never,
        logger: () => {},
      });
      expect(result.appliedIds).toEqual([]);
      expect(result.skippedIds).toEqual(["2026-05-20-skip-me"]);
      // Kein marker geschrieben — beim nächsten Boot ohne Flag würde es laufen
      expect(inserts).toHaveLength(0);
    } finally {
      delete process.env[envKey];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("already-applied seed wird übersprungen", async () => {
    const dir = makeTempSeedsDir([
      { name: "2026-05-19-init.ts", content: makeSeedFile("init") },
      { name: "2026-05-20-new.ts", content: makeSeedFile("new") },
    ]);
    try {
      const { db, inserts } = makeStubDb(["2026-05-19-init"]);
      const result = await runPendingSeedMigrations({
        db: db as never,
        seedsDir: dir,
        appliedBy: "boot",
        createContext: () => ({}) as never,
        logger: () => {},
      });
      // Nur new lief
      expect(result.appliedIds).toEqual(["2026-05-20-new"]);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.["id"]).toBe("2026-05-20-new");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seed-file ohne default-export → klarer Error", async () => {
    const dir = makeTempSeedsDir([
      { name: "2026-05-20-broken.ts", content: "export const notDefault = {};" },
    ]);
    try {
      const { db } = makeStubDb();
      await expect(
        runPendingSeedMigrations({
          db: db as never,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: () => ({}) as never,
          logger: () => {},
        }),
      ).rejects.toThrow(/must export a SeedMigration as default/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seed.run throws → abort + no marker", async () => {
    const dir = makeTempSeedsDir([
      { name: "2026-05-20-good.ts", content: makeSeedFile("good") },
      { name: "2026-05-21-fails.ts", content: makeSeedFile("fails", { fail: true }) },
      { name: "2026-05-22-never.ts", content: makeSeedFile("never") },
    ]);
    try {
      const { db, inserts } = makeStubDb();
      await expect(
        runPendingSeedMigrations({
          db: db as never,
          seedsDir: dir,
          appliedBy: "boot",
          createContext: () => ({}) as never,
          logger: () => {},
        }),
      ).rejects.toThrow();
      // good lief, fails warf, never wurde NIE attempted
      expect(inserts.map((r) => r["id"])).toEqual(["2026-05-20-good"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Test-Helpers -----------------------------------------------------------

function makeSeedFile(
  description: string,
  options: { skippable?: boolean; fail?: boolean } = {},
): string {
  return `
export default {
  description: ${JSON.stringify(description)},
  ${options.skippable ? "skippable: true," : ""}
  run: async () => {
    ${options.fail ? "throw new Error('intentional fail');" : ""}
  },
};
`;
}

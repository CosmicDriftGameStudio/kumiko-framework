import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "../bun-db/query";
import { integer, table as pgTable, serial, text } from "../db/dialect";
import { seedReferenceData } from "../db/reference-data";
import type { ReferenceDataDef } from "../engine/types";
import { unsafePushTables } from "../stack";
import { createBunTestDb, type BunTestDb } from "../bun-db/__tests__/bun-test-db";
import { ensureTemporalPolyfill } from "../time/polyfill";

// --- Tables ---

const countryTable = pgTable("ref_countries", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  region: text("region"),
});

const statusTable = pgTable("ref_statuses", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").default(0),
});

// --- Test state ---

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createBunTestDb();
  await unsafePushTables(testDb.db, { countryTable, statusTable });
});

afterAll(async () => {
  await testDb?.cleanup();
});

// Helper: read all rows from a table
async function readCountries() {
  const rows = await selectMany(testDb.db, countryTable);
  return rows.toSorted((a, b) => a.code.localeCompare(b.code));
}

async function readStatuses() {
  const rows = await selectMany(testDb.db, statusTable);
  return rows.toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

describe("seedReferenceData", () => {
  const tables = new Map<string, typeof countryTable | typeof statusTable>([
    ["country", countryTable],
    ["status", statusTable],
  ]);

  test("inserts initial reference data", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Deutschland", region: "Europe" },
          { code: "AT", name: "Oesterreich", region: "Europe" },
          { code: "JP", name: "Japan", region: "Asia" },
        ],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);

    expect(result).toEqual({ inserted: 3, updated: 0 });

    const rows = await readCountries();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ code: "AT", name: "Oesterreich", region: "Europe" });
    expect(rows[1]).toMatchObject({ code: "DE", name: "Deutschland", region: "Europe" });
    expect(rows[2]).toMatchObject({ code: "JP", name: "Japan", region: "Asia" });
  });

  test("is idempotent — no-op when data unchanged", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Deutschland", region: "Europe" },
          { code: "AT", name: "Oesterreich", region: "Europe" },
          { code: "JP", name: "Japan", region: "Asia" },
        ],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);

    expect(result).toEqual({ inserted: 0, updated: 0 });

    // Data still the same
    const rows = await readCountries();
    expect(rows).toHaveLength(3);
  });

  test("updates changed fields without duplicating rows", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Germany", region: "Europe" }, // name changed
          { code: "AT", name: "Oesterreich", region: "Europe" }, // unchanged
          { code: "JP", name: "Japan", region: "East Asia" }, // region changed
        ],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);

    expect(result).toEqual({ inserted: 0, updated: 2 });

    const rows = await readCountries();
    expect(rows).toHaveLength(3); // no duplicates
    expect(rows[1]).toMatchObject({ code: "DE", name: "Germany", region: "Europe" });
    expect(rows[2]).toMatchObject({ code: "JP", name: "Japan", region: "East Asia" });
  });

  test("inserts new rows alongside existing ones", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Germany", region: "Europe" },
          { code: "CH", name: "Schweiz", region: "Europe" }, // new
        ],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);

    expect(result).toEqual({ inserted: 1, updated: 0 });

    const rows = await readCountries();
    expect(rows).toHaveLength(4);
    expect(rows.find((r: Record<string, unknown>) => r["code"] === "CH")).toMatchObject({
      name: "Schweiz",
      region: "Europe",
    });
  });

  test("custom upsertKey — matches on specified field instead of first", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "status",
        data: [
          { slug: "draft", label: "Draft", sortOrder: 1 },
          { slug: "active", label: "Active", sortOrder: 2 },
          { slug: "archived", label: "Archived", sortOrder: 3 },
        ],
        upsertKey: "slug",
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);
    expect(result).toEqual({ inserted: 3, updated: 0 });

    // Update label via same upsertKey
    const updateDefs: ReferenceDataDef[] = [
      {
        entityName: "status",
        data: [
          { slug: "draft", label: "Entwurf", sortOrder: 1 }, // label changed
          { slug: "active", label: "Active", sortOrder: 2 }, // unchanged
        ],
        upsertKey: "slug",
      },
    ];

    const updateResult = await seedReferenceData(updateDefs, tables, testDb.db);
    expect(updateResult).toEqual({ inserted: 0, updated: 1 });

    const rows = await readStatuses();
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "draft")).toMatchObject({
      label: "Entwurf",
    });
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "active")).toMatchObject({
      label: "Active",
    });
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "archived")).toMatchObject({
      label: "Archived",
    });
  });

  test("skips unknown entity names gracefully", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "nonexistent",
        data: [{ code: "X", name: "Unknown" }],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);
    expect(result).toEqual({ inserted: 0, updated: 0 });
  });

  test("skips empty data arrays", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [],
      },
    ];

    const result = await seedReferenceData(defs, tables, testDb.db);
    expect(result).toEqual({ inserted: 0, updated: 0 });
  });
});

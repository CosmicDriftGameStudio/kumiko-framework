// Reference Data Sample — Integration Test
// Proves: seed data is inserted, upsert updates existing rows, new rows added

import { seedReferenceData } from "@cosmicdrift/kumiko-framework/db";
import type { ReferenceDataDef } from "@cosmicdrift/kumiko-framework/engine";
import { createTestDb, type TestDb, unsafePushTables } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { categoryFeature, categoryTable } from "../feature";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafePushTables(testDb.db, { categoryTable });
});

afterAll(async () => {
  await testDb?.cleanup();
});

async function readCategories() {
  const rows = await testDb.db.select().from(categoryTable);
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

describe("reference data seeding", () => {
  test("inserts initial seed data", async () => {
    const tables = new Map([["category", categoryTable]]);

    // seedReferenceData(defs, tables, db)
    await seedReferenceData(categoryFeature.referenceData, tables, testDb.db);

    const rows = await readCategories();
    expect(rows).toHaveLength(4);
    expect(rows[0]?.code).toBe("books");
    expect(rows[1]?.code).toBe("clothing");
    expect(rows[2]?.code).toBe("electronics");
    expect(rows[3]?.code).toBe("food");
  });

  test("upsert updates existing rows without duplicating", async () => {
    const tables = new Map([["category", categoryTable]]);

    // Modified seed data: changed name for "books", added new category
    const updatedDefs: ReferenceDataDef[] = [
      {
        entityName: "category",
        data: [
          { code: "electronics", name: "Electronics", description: "Phones, laptops, tablets" },
          { code: "clothing", name: "Clothing", description: "Shirts, pants, shoes" },
          { code: "books", name: "Books & Media", description: "Books, audiobooks, magazines" },
          { code: "food", name: "Food & Drinks", description: "Groceries and beverages" },
          { code: "sports", name: "Sports", description: "Equipment and gear" },
        ],
        upsertKey: "code",
      },
    ];

    await seedReferenceData(updatedDefs, tables, testDb.db);

    const rows = await readCategories();
    expect(rows).toHaveLength(5);

    const books = rows.find((r) => r.code === "books");
    expect(books?.name).toBe("Books & Media");

    const sports = rows.find((r) => r.code === "sports");
    expect(sports?.name).toBe("Sports");
  });
});

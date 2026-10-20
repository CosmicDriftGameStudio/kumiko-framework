// Reference Data Sample — Integration Test
// Proves: seed data is inserted, upsert updates existing rows, new rows added

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { seedReferenceData, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { ReferenceDataDef } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { categoryEntity, categoryFeature, categoryTable } from "../feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [categoryFeature] });
  await unsafeCreateEntityTable(stack.db, categoryEntity, "category");
});

afterAll(async () => {
  await stack?.cleanup();
});

type CategoryRow = { code: string; name: string; description: string | null };

async function readCategories(): Promise<CategoryRow[]> {
  const rows = await selectMany(stack.db, categoryTable);
  return [...rows].sort((a: CategoryRow, b: CategoryRow) => a.code.localeCompare(b.code));
}

describe("reference data seeding", () => {
  test("inserts initial seed data", async () => {
    await seedReferenceData(categoryFeature.referenceData, stack.registry, stack.db);

    const rows = await readCategories();
    expect(rows).toHaveLength(4);
    expect(rows[0]?.code).toBe("books");
    expect(rows[1]?.code).toBe("clothing");
    expect(rows[2]?.code).toBe("electronics");
    expect(rows[3]?.code).toBe("food");
  });

  test("upsert updates existing rows without duplicating", async () => {
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

    await seedReferenceData(updatedDefs, stack.registry, stack.db);

    const rows = await readCategories();
    expect(rows).toHaveLength(5);

    const books = rows.find((r: CategoryRow) => r.code === "books");
    expect(books?.name).toBe("Books & Media");

    const sports = rows.find((r: CategoryRow) => r.code === "sports");
    expect(sports?.name).toBe("Sports");

    // Seeded rows are event-sourced: a projection rebuild keeps them.
    await rebuildProjection("catalog:projection:category-entity", {
      db: stack.db,
      registry: stack.registry,
    });
    const rebuilt = await readCategories();
    expect(rebuilt).toHaveLength(5);
    expect(rebuilt.find((r: CategoryRow) => r.code === "books")?.name).toBe("Books & Media");
  });
});

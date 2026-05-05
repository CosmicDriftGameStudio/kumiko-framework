// Reference Data Sample
// Shows: r.referenceData() for static seed data with upsert logic

import { table, text } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const categoryEntity = createEntity({
  table: "read_sample_categories",
  fields: {
    code: createTextField({ required: true }),
    name: createTextField({ required: true }),
    description: createTextField(),
  },
});

// Drizzle table for direct DB queries in tests
export const categoryTable = table("read_sample_categories", {
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
});

export const categoryFeature = defineFeature("catalog", (r) => {
  r.entity("category", categoryEntity);

  // Static reference data — seeded on boot, upserted on changes
  r.referenceData(
    "category",
    [
      { code: "electronics", name: "Electronics", description: "Phones, laptops, tablets" },
      { code: "clothing", name: "Clothing", description: "Shirts, pants, shoes" },
      { code: "books", name: "Books", description: "Fiction and non-fiction" },
      { code: "food", name: "Food & Drinks", description: "Groceries and beverages" },
    ],
    { upsertKey: "code" },
  );
});

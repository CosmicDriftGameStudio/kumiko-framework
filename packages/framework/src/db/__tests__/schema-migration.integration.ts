import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "../../engine";
import type { FeatureDefinition } from "../../engine/types";
import { createTestDb, pushTables, type TestDb } from "../../testing";
import { generateSchemaSource } from "../schema-generator";
import { buildDrizzleTable } from "../table-builder";

/**
 * Integration tests for the schema migration workflow.
 * Tests real developer scenarios: new feature, add field, change field, etc.
 *
 * Each test simulates:
 *   1. Developer defines/changes entities
 *   2. Generator creates schema source
 *   3. Schema is applied to a real database (via drizzle-kit push simulation)
 *   4. We verify the DB state matches expectations
 *
 * Since drizzle-kit push requires CLI invocation, we test the generator output
 * and validate it produces correct, executable SQL by running it directly.
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb?.cleanup();
});

// Helper: apply schema by building Drizzle tables and pushing via drizzle-kit
async function applySchema(features: readonly FeatureDefinition[]): Promise<string> {
  const source = generateSchemaSource(features);

  const tables: Record<string, unknown> = {};
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities)) {
      tables[entityName] = buildDrizzleTable(entityName, entity);
    }
  }
  await pushTables(testDb.db, tables);

  return source;
}

// Helper: read column info from information_schema
async function getTableColumns(
  tableName: string,
): Promise<Map<string, { dataType: string; isNullable: boolean }>> {
  const rows = await testDb.db.execute<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    sql.raw(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`,
    ),
  );

  const result = new Map<string, { dataType: string; isNullable: boolean }>();
  for (const row of rows) {
    result.set(row.column_name, {
      dataType: row.data_type,
      isNullable: row.is_nullable === "YES",
    });
  }
  return result;
}

describe("schema migration workflows", () => {
  test("workflow 1: new feature creates table with all base + field columns", async () => {
    const feature = defineFeature("blog", (r) => {
      r.entity(
        "post",
        createEntity({
          table: "wf1_posts",
          fields: {
            title: createTextField({ required: true }),
            body: createTextField(),
            viewCount: createNumberField(),
            publishedAt: createDateField(),
            isDraft: createBooleanField({ default: true }),
          },
        }),
      );
    });

    await applySchema([feature]);

    const columns = await getTableColumns("wf1_posts");

    // Base columns
    expect(columns.has("id")).toBe(true);
    expect(columns.has("tenant_id")).toBe(true);
    expect(columns.has("version")).toBe(true);
    expect(columns.has("inserted_at")).toBe(true);
    expect(columns.has("modified_at")).toBe(true);
    expect(columns.has("inserted_by_id")).toBe(true);
    expect(columns.has("modified_by_id")).toBe(true);

    // Entity fields
    expect(columns.get("title")?.dataType).toBe("text");
    expect(columns.get("body")?.dataType).toBe("text");
    expect(columns.get("view_count")?.dataType).toBe("integer");
    expect(columns.get("published_at")?.dataType).toContain("timestamp");
    expect(columns.get("is_draft")?.dataType).toBe("boolean");
    expect(columns.get("is_draft")?.isNullable).toBe(false); // has default → NOT NULL

    // No soft delete
    expect(columns.has("is_deleted")).toBe(false);
  });

  test("workflow 2: add field to existing entity → ADD COLUMN", async () => {
    // Initial entity with just email
    const initialEntity = createEntity({ table: "wf2_users", fields: { email: createTextField() } });
    await pushTables(testDb.db, { user: buildDrizzleTable("user", initialEntity) });

    // Developer adds a new field
    const feature = defineFeature("accounts", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "wf2_users",
          fields: {
            email: createTextField(),
            displayName: createTextField(), // NEW FIELD
          },
        }),
      );
    });

    // Generator produces schema with both fields
    const source = generateSchemaSource([feature]);
    expect(source).toContain('email: text("email")');
    expect(source).toContain('displayName: text("display_name")');

    // Push updated schema — drizzle-kit generates ALTER TABLE ADD COLUMN
    const updatedEntity = feature.entities["user"]!;
    await pushTables(
      testDb.db,
      { user: buildDrizzleTable("user", updatedEntity) },
      { user: buildDrizzleTable("user", initialEntity) },
    );

    const columns = await getTableColumns("wf2_users");
    expect(columns.has("display_name")).toBe(true);
    expect(columns.has("email")).toBe(true);
    expect(columns.get("display_name")?.dataType).toBe("text");
  });

  test("workflow 3: add required boolean field with default → safe ADD COLUMN", async () => {
    // Initial entity with just name
    const initialEntity = createEntity({ table: "wf3_projects", fields: { name: createTextField() } });
    const initialTable = buildDrizzleTable("project", initialEntity);
    await pushTables(testDb.db, { project: initialTable });

    // Insert a row first (to prove ADD COLUMN with default doesn't break existing rows)
    await testDb.db.execute(
      sql.raw(`INSERT INTO "wf3_projects" (tenant_id, name) VALUES (1, 'Test Project')`),
    );

    // Developer adds boolean field with default
    const updatedEntity = createEntity({
      table: "wf3_projects",
      fields: { name: createTextField(), isArchived: createBooleanField({ default: false }) },
    });
    await pushTables(
      testDb.db,
      { project: buildDrizzleTable("project", updatedEntity) },
      { project: initialTable },
    );

    // Existing row should have the default value
    const rows = await testDb.db.execute<{ name: string; is_archived: boolean }>(
      sql.raw(`SELECT name, is_archived FROM "wf3_projects"`),
    );

    expect(rows[0]).toMatchObject({ name: "Test Project", is_archived: false });
  });

  test("workflow 4: activate soft delete → adds 3 columns", async () => {
    const feature = defineFeature("tasks", (r) => {
      r.entity(
        "task",
        createEntity({
          table: "wf4_tasks",
          fields: { title: createTextField() },
          softDelete: true,
        }),
      );
    });

    await applySchema([feature]);

    const columns = await getTableColumns("wf4_tasks");

    expect(columns.has("is_deleted")).toBe(true);
    expect(columns.get("is_deleted")?.isNullable).toBe(false);
    expect(columns.has("deleted_at")).toBe(true);
    expect(columns.get("deleted_at")?.isNullable).toBe(true);
    expect(columns.has("deleted_by_id")).toBe(true);
  });

  test("workflow 5: multiple features each create their own tables", async () => {
    const blogFeature = defineFeature("blog", (r) => {
      r.entity(
        "article",
        createEntity({ table: "wf5_articles", fields: { title: createTextField() } }),
      );
    });

    const shopFeature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          table: "wf5_products",
          fields: { name: createTextField(), price: createNumberField() },
        }),
      );
    });

    await applySchema([blogFeature, shopFeature]);

    const articleColumns = await getTableColumns("wf5_articles");
    const productColumns = await getTableColumns("wf5_products");

    expect(articleColumns.has("title")).toBe(true);
    expect(productColumns.has("name")).toBe(true);
    expect(productColumns.has("price")).toBe(true);
  });

  test("workflow 6: generator output is idempotent", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "idempotent_users",
          fields: {
            email: createTextField({ searchable: true }),
            isActive: createBooleanField({ default: true }),
          },
          softDelete: true,
        }),
      );
    });

    const output1 = generateSchemaSource([feature]);
    const output2 = generateSchemaSource([feature]);

    expect(output1).toBe(output2);
  });

  test("workflow 7: generated schema contains no framework dependencies", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "check_items",
          fields: {
            name: createTextField(),
            count: createNumberField(),
            isEnabled: createBooleanField({ default: false }),
            createdOn: createDateField(),
            avatar: { type: "image" },
            docs: { type: "files", maxCount: 5 },
          },
          softDelete: true,
        }),
      );
    });

    const source = generateSchemaSource([feature]);

    // Only drizzle-orm imports
    const lines = source.split("\n");
    const imports = lines.filter((l) => l.startsWith("import"));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("drizzle-orm/pg-core");

    // No framework references
    expect(source).not.toContain("@kumiko");
    expect(source).not.toContain("createEntity");
    expect(source).not.toContain("buildDrizzleTable");

    // Multi-file field (docs) produces no column
    expect(source).not.toContain("docs");
    // Single-file field (avatar) produces integer column
    expect(source).toContain('avatar: integer("avatar")');
  });
});

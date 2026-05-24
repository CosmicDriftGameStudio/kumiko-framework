import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, insertOne, selectMany } from "../../bun-db/query";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "../../engine";
import type { FeatureDefinition } from "../../engine/types";
import { createTestDb, type TestDb, unsafePushTables } from "../../stack";
import { buildEntityTable } from "../table-builder";

/**
 * Integration tests for the schema migration workflow.
 * Tests real developer scenarios: new feature, add field, change field, etc.
 *
 * Each test simulates:
 *   1. Developer defines/changes entities
 *   2. buildEntityTable creates Drizzle table objects
 *   3. Schema is applied to a real database via unsafePushTables (drizzle-kit push)
 *   4. We verify the DB state matches expectations
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb?.cleanup();
});

// Helper: apply schema by building Drizzle tables and pushing via drizzle-kit
async function applySchema(features: readonly FeatureDefinition[]): Promise<void> {
  const tables: Record<string, unknown> = {};
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities)) {
      tables[entityName] = buildEntityTable(entityName, entity);
    }
  }
  await unsafePushTables(testDb.db, tables);
}

// Helper: read column info from information_schema
async function getTableColumns(
  tableName: string,
): Promise<Map<string, { dataType: string; isNullable: boolean }>> {
  const rows = await asRawClient(testDb.db).unsafe<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [tableName],
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

  test("workflow 1b: tenant_id index is created on every table", async () => {
    const feature = defineFeature("indexed-blog", (r) => {
      r.entity(
        "article",
        createEntity({
          table: "wf1b_articles",
          fields: { title: createTextField() },
        }),
      );
    });
    await applySchema([feature]);

    const indexRows = await asRawClient(testDb.db).unsafe<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'wf1b_articles' AND indexname = 'wf1b_articles_tenant_id_idx'`,
    );
    expect(indexRows.length).toBe(1);
    expect(indexRows[0]?.indexdef).toContain("tenant_id");
  });

  test("workflow 2: add field to existing entity → ADD COLUMN", async () => {
    // Initial entity with just email
    const initialEntity = createEntity({
      table: "wf2_users",
      fields: { email: createTextField() },
    });
    await unsafePushTables(testDb.db, { user: buildEntityTable("user", initialEntity) });

    // Developer adds a new field
    const updatedEntity = createEntity({
      table: "wf2_users",
      fields: {
        email: createTextField(),
        displayName: createTextField(), // NEW FIELD
      },
    });

    // Push updated schema — drizzle-kit generates ALTER TABLE ADD COLUMN
    await unsafePushTables(
      testDb.db,
      { user: buildEntityTable("user", updatedEntity) },
      { user: buildEntityTable("user", initialEntity) },
    );

    const columns = await getTableColumns("wf2_users");
    expect(columns.has("display_name")).toBe(true);
    expect(columns.has("email")).toBe(true);
    expect(columns.get("display_name")?.dataType).toBe("text");
  });

  test("workflow 3: add required boolean field with default → safe ADD COLUMN", async () => {
    // Initial entity with just name
    const initialEntity = createEntity({
      table: "wf3_projects",
      fields: { name: createTextField() },
    });
    const initialTable = buildEntityTable("project", initialEntity);
    await unsafePushTables(testDb.db, { project: initialTable });

    // Insert a row first (to prove ADD COLUMN with default doesn't break existing rows)
    await insertOne(testDb.db, initialTable, {
      tenantId: "00000000-0000-4000-8000-000000000001",
      name: "Test Project",
    });

    // Developer adds boolean field with default
    const updatedEntity = createEntity({
      table: "wf3_projects",
      fields: { name: createTextField(), isArchived: createBooleanField({ default: false }) },
    });
    const updatedTable = buildEntityTable("project", updatedEntity);
    await unsafePushTables(testDb.db, { project: updatedTable }, { project: initialTable });

    // Existing row should have the default value
    const rows = await selectMany(testDb.db, updatedTable);

    expect(rows[0]).toMatchObject({ name: "Test Project", isArchived: false });
  });

  test("workflow 3b: text field with default → DEFAULT-clause backfills existing rows", async () => {
    // Pinned der text-default-bug: `createTextField({ default: "..." })`
    // muss die DEFAULT-Klausel ins generierte SQL durchreichen, sonst
    // bricht ALTER TABLE ADD COLUMN auf existing data (NOT NULL ohne
    // DEFAULT failt). Vorher hat der text-Branch in table-builder das
    // `field.default` ignoriert; dieser Test pinst dass es jetzt
    // greift.
    const initialEntity = createEntity({
      table: "wf3b_users",
      fields: { email: createTextField({ required: true }) },
    });
    const initialTable = buildEntityTable("user", initialEntity);
    await unsafePushTables(testDb.db, { user: initialTable });

    await insertOne(testDb.db, initialTable, {
      tenantId: "00000000-0000-4000-8000-000000000001",
      email: "x@y.z",
    });

    const updatedEntity = createEntity({
      table: "wf3b_users",
      fields: {
        email: createTextField({ required: true }),
        roles: createTextField({ required: true, default: "[]" }),
      },
    });
    const updatedTable = buildEntityTable("user", updatedEntity);
    await unsafePushTables(testDb.db, { user: updatedTable }, { user: initialTable });

    const rows = await selectMany(testDb.db, updatedTable);
    expect(rows[0]).toMatchObject({ email: "x@y.z", roles: "[]" });
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
});

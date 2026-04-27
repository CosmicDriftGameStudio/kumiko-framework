import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import {
  createBooleanField,
  createEntity,
  createImageField,
  createMultiSelectField,
  createSelectField,
  createTextField,
} from "../../engine";
import type { EntityRelations } from "../../engine/types";
import { decodeCursor, encodeCursor } from "../cursor";
import { buildBaseColumns, buildDrizzleTable, toTableName } from "../table-builder";

// --- Cursor encoding ---

describe("cursor encoding", () => {
  // String-Roundtrip seit Sprint F: encodeCursor akzeptiert string|number,
  // decodeCursor returnt immer einen String — UUID-IDs (Default) brauchen
  // keine Number-Kapsel, Integer-IDs werden via PG-Cast in der WHERE-Clause
  // korrekt verglichen. Detail-Tests in cursor.test.ts.
  test.each([1, 42, 999, 100000])("encodes and decodes integer id %i", (id) => {
    const cursor = encodeCursor(id);
    expect(decodeCursor(cursor)).toBe(String(id));
  });

  test("cursor is url-safe base64", () => {
    const cursor = encodeCursor(12345);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("throws on empty/corrupted cursor", () => {
    expect(() => decodeCursor("")).toThrow(/invalid cursor/i);
  });
});

// --- Base columns ---

describe("buildBaseColumns", () => {
  test("includes standard columns", () => {
    const cols = buildBaseColumns(false);
    expect(cols).toHaveProperty("id");
    expect(cols).toHaveProperty("tenantId");
    expect(cols).toHaveProperty("insertedAt");
    expect(cols).toHaveProperty("modifiedAt");
    expect(cols).toHaveProperty("insertedById");
    expect(cols).toHaveProperty("modifiedById");
  });

  test("without softDelete has no isDeleted", () => {
    const cols = buildBaseColumns(false);
    expect(cols).not.toHaveProperty("isDeleted");
  });

  test("with softDelete includes isDeleted", () => {
    const cols = buildBaseColumns(true);
    expect(cols).toHaveProperty("isDeleted");
  });
});

// --- Table builder ---

describe("buildDrizzleTable", () => {
  test("creates table with base columns + entity fields", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        email: createTextField({ required: true }),
        firstName: createTextField(),
        isEnabled: createBooleanField({ default: true }),
      },
    });

    const table = buildDrizzleTable("user", entity);

    // Has base columns
    expect(table["id"]).toBeDefined();
    expect(table["tenantId"]).toBeDefined();
    expect(table["insertedAt"]).toBeDefined();

    // Has entity fields
    expect(table["email"]).toBeDefined();
    expect(table["firstName"]).toBeDefined();
    expect(table["isEnabled"]).toBeDefined();
  });

  test("soft delete entity includes isDeleted column", () => {
    const entity = createEntity({
      table: "users",
      fields: { email: createTextField() },
      softDelete: true,
    });

    const table = buildDrizzleTable("user", entity);
    expect(table["isDeleted"]).toBeDefined();
  });

  test("select field becomes text column", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        locale: createSelectField({ options: ["de", "en"] as const }),
      },
    });

    const table = buildDrizzleTable("user", entity);
    expect(table["locale"]).toBeDefined();
  });

  test("multiSelect field becomes jsonb column with default []", () => {
    const entity = createEntity({
      table: "drivers",
      fields: {
        licenceClasses: createMultiSelectField({ options: ["B", "BE", "C"] as const }),
      },
    });

    const table = buildDrizzleTable("driver", entity);
    const config = getTableConfig(table);
    const column = config.columns.find((c) => c.name === "licence_classes");
    expect(column).toBeDefined();
    // jsonb-customType: column-data-type ist string ("jsonb"); column-type
    // hier reicht als Smoke — die Default-`[]`-Garantie testen wir indirekt
    // über die Migration-Rebuild-Integration-Tests, die echte Inserts
    // gegen Postgres machen.
    expect(column?.dataType).toBe("json");
    expect(column?.default).toEqual([]);
  });

  test("converts camelCase to snake_case", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        firstName: createTextField(),
        employmentType: createSelectField({ options: ["FullTime", "PartTime"] as const }),
      },
    });

    const table = buildDrizzleTable("user", entity);
    // Column objects exist under camelCase keys
    expect(table["firstName"]).toBeDefined();
    expect(table["employmentType"]).toBeDefined();
  });

  test("featureName option prefixes table name", () => {
    const entity = createEntity({
      table: "orders",
      fields: { name: createTextField() },
    });

    const table = buildDrizzleTable("order", entity, { featureName: "shop" });
    expect(getTableName(table)).toBe("shop_orders");
  });

  test("without featureName, table name is unchanged", () => {
    const entity = createEntity({
      table: "orders",
      fields: { name: createTextField() },
    });

    const table = buildDrizzleTable("order", entity);
    expect(getTableName(table)).toBe("orders");
  });

  test("derives table name from entityName when table is omitted", () => {
    const entity = createEntity({ fields: { name: createTextField() } });
    const table = buildDrizzleTable("task", entity);
    expect(getTableName(table)).toBe("read_tasks");
  });

  test("derives table name with featureName prefix when table is omitted", () => {
    const entity = createEntity({ fields: { name: createTextField() } });
    const table = buildDrizzleTable("order", entity, { featureName: "shop" });
    // featureName-Prefix landet zwischen `read_` und dem Plural — alle
    // Read-Models starten konsistent mit `read_`, egal ob ein Feature-
    // Prefix gesetzt ist oder nicht.
    expect(getTableName(table)).toBe("read_shop_orders");
  });
});

// --- Auto-Indices ---

describe("buildDrizzleTable auto-indices", () => {
  test("every table gets a tenant_id index", () => {
    const entity = createEntity({
      table: "users",
      fields: { email: createTextField() },
    });
    const table = buildDrizzleTable("user", entity);
    const { indexes } = getTableConfig(table);

    const tenantIndex = indexes.find((idx) => idx.config.name === "users_tenant_id_idx");
    expect(tenantIndex).toBeDefined();
    expect(tenantIndex?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "tenant_id",
    ]);
  });

  test("file field produces an index on its column", () => {
    const entity = createEntity({
      table: "documents",
      fields: {
        title: createTextField(),
        avatar: createImageField(),
      },
    });
    const table = buildDrizzleTable("document", entity);
    const { indexes } = getTableConfig(table);

    const avatarIndex = indexes.find((idx) => idx.config.name === "documents_avatar_idx");
    expect(avatarIndex).toBeDefined();
  });

  test("index names include feature prefix when featureName is set", () => {
    const entity = createEntity({
      table: "items",
      fields: { name: createTextField() },
    });
    const table = buildDrizzleTable("item", entity, { featureName: "shop" });
    const { indexes } = getTableConfig(table);

    expect(indexes.some((idx) => idx.config.name === "shop_items_tenant_id_idx")).toBe(true);
  });

  test("table without file fields or relations has only the tenant index", () => {
    const entity = createEntity({
      table: "notes",
      fields: { body: createTextField() },
    });
    const table = buildDrizzleTable("note", entity);
    const { indexes } = getTableConfig(table);

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.config.name).toBe("notes_tenant_id_idx");
  });

  test("belongsTo relations produce an index on their foreign key column", () => {
    const entity = createEntity({
      table: "tasks",
      fields: {
        title: createTextField({ required: true }),
        assigneeId: createTextField(),
        projectId: createTextField(),
      },
    });
    const relations: EntityRelations = {
      assignee: { type: "belongsTo", target: "user", foreignKey: "assigneeId" },
      project: { type: "belongsTo", target: "project", foreignKey: "projectId" },
    };
    const table = buildDrizzleTable("task", entity, { relations });
    const { indexes } = getTableConfig(table);

    const names = indexes.map((i) => i.config.name);
    expect(names).toContain("tasks_tenant_id_idx");
    expect(names).toContain("tasks_assignee_id_idx");
    expect(names).toContain("tasks_project_id_idx");
  });

  test("hasMany / manyToMany relations do NOT produce indexes on this table (their FK lives on the other side)", () => {
    const entity = createEntity({
      table: "teams",
      fields: { name: createTextField() },
    });
    const relations: EntityRelations = {
      members: { type: "hasMany", target: "user", foreignKey: "teamId" },
      tags: {
        type: "manyToMany",
        target: "tag",
        through: { table: "team_tags", sourceKey: "teamId", targetKey: "tagId" },
      },
    };
    const table = buildDrizzleTable("team", entity, { relations });
    const { indexes } = getTableConfig(table);

    // Only the tenant index — hasMany FK lives on the "user" table; the join
    // table for manyToMany isn't owned by this entity either.
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.config.name).toBe("teams_tenant_id_idx");
  });

  test("relation and file field on the same column deduplicate to one index", () => {
    const entity = createEntity({
      table: "photos",
      fields: {
        title: createTextField(),
        ownerId: createImageField(), // contrived: name collides with an FK relation below
      },
    });
    const relations: EntityRelations = {
      owner: { type: "belongsTo", target: "user", foreignKey: "ownerId" },
    };
    const table = buildDrizzleTable("photo", entity, { relations });
    const { indexes } = getTableConfig(table);

    const names = indexes.map((i) => i.config.name);
    // Exactly one owner_id index, not two
    expect(names.filter((n) => n === "photos_owner_id_idx")).toHaveLength(1);
  });
});

// --- toTableName ---

describe("toTableName", () => {
  test.each([
    ["task", "read_tasks"],
    ["user", "read_users"],
    ["tenant", "read_tenants"],
  ])("simple plural: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });

  test.each([
    ["category", "read_categories"],
    ["entity", "read_entities"],
    ["policy", "read_policies"],
  ])("y → ies: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });

  test.each([
    ["key", "read_keys"],
    ["survey", "read_surveys"],
    ["day", "read_days"],
  ])("vowel+y stays: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });

  test.each([
    ["status", "read_statuses"],
    ["address", "read_addresses"],
    ["match", "read_matches"],
    ["tax", "read_taxes"],
    ["wish", "read_wishes"],
  ])("sibilant → es: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });

  test.each([
    ["memberTask", "read_member_tasks"],
    ["userProfile", "read_user_profiles"],
    ["orderItem", "read_order_items"],
  ])("camelCase → snake_case + plural: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });

  test.each([
    ["tenant-membership", "read_tenant_memberships"],
    ["user-profile-address", "read_user_profile_addresses"],
    ["invoice-issuer", "read_invoice_issuers"],
  ])("kebab-case → snake_case + plural: %s → %s", (input, expected) => {
    expect(toTableName(input)).toBe(expected);
  });
});

// --- Sorting in CursorQueryOptions ---

describe("sorting", () => {
  test("CursorQueryOptions accepts sort and sortDirection", () => {
    // Type-level test: this should compile
    const opts: import("../cursor").CursorQueryOptions = {
      tenantId: "00000000-0000-4000-8000-000000000001",
      sort: "lastName",
      sortDirection: "asc",
    };
    expect(opts.sort).toBe("lastName");
    expect(opts.sortDirection).toBe("asc");
  });
});

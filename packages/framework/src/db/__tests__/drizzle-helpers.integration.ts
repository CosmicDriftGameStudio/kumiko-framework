import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import { applyCursorQuery, encodeCursor } from "../cursor";
import { buildDrizzleTable } from "../table-builder";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const TEST_DB_URL = requireEnv("TEST_DATABASE_URL");

type Row = Record<string, unknown>;

const entity = createEntity({
  table: "test_users",
  fields: {
    email: createTextField({ required: true, searchable: true }),
    firstName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const table = buildDrizzleTable("testUser", entity);

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  const adminClient = postgres(TEST_DB_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient`DROP DATABASE IF EXISTS kumiko_test_step7`;
    await adminClient`CREATE DATABASE kumiko_test_step7`;
  } finally {
    await adminClient.end();
  }

  const testUrl = TEST_DB_URL.replace(/\/[^/]+$/, "/kumiko_test_step7");
  client = postgres(testUrl);
  db = drizzle(client);

  await db.execute(sql`
    CREATE TABLE test_users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
      modified_at TIMESTAMP,
      inserted_by_id INTEGER,
      modified_by_id INTEGER,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      email TEXT,
      first_name TEXT,
      is_enabled BOOLEAN DEFAULT TRUE NOT NULL
    )
  `);

  const rows = [
    { tenantId: 1, email: "admin@test.de", firstName: "Admin" },
    { tenantId: 1, email: "marc@test.de", firstName: "Marc" },
    { tenantId: 1, email: "anna@test.de", firstName: "Anna" },
    { tenantId: 1, email: "deleted@test.de", firstName: "Deleted", isDeleted: true },
    { tenantId: 2, email: "other@test.de", firstName: "Other" },
  ];

  for (const row of rows) {
    await db.insert(table).values({
      tenantId: row.tenantId,
      email: row.email,
      firstName: row.firstName,
      isEnabled: true,
      isDeleted: row.isDeleted ?? false,
    });
  }
});

afterAll(async () => {
  await client.end();
  const adminClient = postgres(TEST_DB_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient`DROP DATABASE IF EXISTS kumiko_test_step7`;
  } finally {
    await adminClient.end();
  }
});

async function query(options: Parameters<typeof applyCursorQuery>[2]): Promise<Row[]> {
  return applyCursorQuery(db.select().from(table).$dynamic(), table, options);
}

// --- Tests ---

describe("tenant isolation", () => {
  test("only returns rows for specified tenant", async () => {
    const rows = await query({ tenantId: 1 });
    expect(rows.every((r) => r["tenantId"] === 1)).toBe(true);
  });

  test("tenant 2 only sees own data", async () => {
    const rows = await query({ tenantId: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["email"]).toBe("other@test.de");
  });
});

describe("soft delete filtering", () => {
  test("excludes soft-deleted rows", async () => {
    const rows = await query({ tenantId: 1 });
    expect(rows.find((r) => r["email"] === "deleted@test.de")).toBeUndefined();
  });
});

describe("cursor pagination", () => {
  test("limits results", async () => {
    const rows = await query({ tenantId: 1, limit: 2 });
    expect(rows).toHaveLength(2);
  });

  test("cursor skips past previous results", async () => {
    const page1 = await query({ tenantId: 1, limit: 2 });
    expect(page1).toHaveLength(2);

    const lastId = page1[page1.length - 1]?.["id"] as number;
    const page2 = await query({ tenantId: 1, limit: 2, cursor: encodeCursor(lastId) });

    const page1Ids = page1.map((r) => r["id"]);
    const page2Ids = page2.map((r) => r["id"]);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });
});

describe("search", () => {
  test("filters by search term across searchable columns", async () => {
    const rows = await query({
      tenantId: 1,
      search: "marc",
      searchColumns: ["email", "firstName"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["email"]).toBe("marc@test.de");
  });

  test("search is case-insensitive", async () => {
    const rows = await query({ tenantId: 1, search: "ANNA", searchColumns: ["firstName"] });
    expect(rows).toHaveLength(1);
  });

  test("search across multiple columns (OR)", async () => {
    const rows = await query({
      tenantId: 1,
      search: "admin",
      searchColumns: ["email", "firstName"],
    });
    expect(rows).toHaveLength(1);
  });
});

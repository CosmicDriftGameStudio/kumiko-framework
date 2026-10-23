// A tenant-mode TenantDb must not inherit the scope a caller pinned onto its runner.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { table, text, uuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import {
  runInRowLevelSecurityScope,
  systemScopedRunner,
  tenantRowLevelSecurityScope,
} from "../../db/row-level-security-scope.ts";
import { unsafePushTables } from "../../db/table-push.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import { tenantDbRunner } from "../../db/tenant-db-runner.ts";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const itemsTable = table("fw4_pinned_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const admin = TestUsers.admin;
const other = TestUsers.otherTenant;
const labelsOf = (rows: readonly { label: string }[]) => rows.map((row) => row.label).sort();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [defineFeature("pinned", () => {})] });
  await unsafePushTables(stack.unscopedDb, { items: itemsTable });
  await insertOne(stack.db, itemsTable, { tenantId: admin.tenantId, label: "own" });
  await insertOne(stack.db, itemsTable, { tenantId: other.tenantId, label: "foreign" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("createTenantDb over a pre-scoped runner", () => {
  const pinned = () =>
    systemScopedRunner(stack.unscopedDb, "test pins a system-scoped runner over the unscoped db");
  const readRaw = (tenantDb: ReturnType<typeof createTenantDb>) =>
    runInRowLevelSecurityScope(tenantRowLevelSecurityScope(admin.tenantId), () =>
      selectMany<{ label: string }>(tenantDbRunner(tenantDb), itemsTable),
    );

  test("tenant mode sees its own tenant only through the raw runner", async () => {
    const tenantDb = createTenantDb({ db: pinned(), tenantId: admin.tenantId });
    expect(labelsOf(await readRaw(tenantDb))).toEqual(["own"]);
  });

  test("system mode keeps the pinned system scope and sees every tenant", async () => {
    const systemDb = createTenantDb({ db: pinned(), tenantId: admin.tenantId, mode: "system" });
    expect(labelsOf(await readRaw(systemDb))).toEqual(["foreign", "own"]);
  });

  test("tenant mode TenantDb methods stay within the tenant", async () => {
    const tenantDb = createTenantDb({ db: pinned(), tenantId: admin.tenantId });
    expect(labelsOf(await tenantDb.selectMany<{ label: string }>(itemsTable))).toEqual(["own"]);
  });
});

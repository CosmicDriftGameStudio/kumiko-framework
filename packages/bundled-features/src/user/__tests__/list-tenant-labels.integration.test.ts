// user:list derives its `tenants` column from the tenant feature's membership
// tables. Without that feature there are no labels to derive; with it, a
// failing join must not be swallowed into an empty column.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { executeRawQuery } from "@cosmicdrift/kumiko-framework/db";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { UserHandlers, UserQueries } from "../constants.js";
import { createUserFeature } from "../feature.js";
import { userEntity } from "../schema/user.js";

const systemAdmin = TestUsers.systemAdmin;

let seededUserCount = 0;

async function seedUser(stack: TestStack): Promise<string> {
  seededUserCount += 1;
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: `label-user-${seededUserCount}@example.com`,
      displayName: "Label User",
      passwordHash: "seeded-hash",
    },
    systemAdmin,
  );
  return created.id;
}

describe("user:list without the tenant feature", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [createUserFeature()] });
    await unsafeCreateEntityTable(stack.db, userEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("lists users with an empty tenants label and no membership lookup", async () => {
    await seedUser(stack);

    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      UserQueries.list,
      {},
      systemAdmin,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.["tenants"] ?? "").toBe("");
  });

  test("detail loads the user with an empty tenants label and no membership lookup", async () => {
    const id = await seedUser(stack);

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id },
      systemAdmin,
    );

    expect(detail["id"]).toBe(id);
    expect(detail["tenants"] ?? "").toBe("");
  });
});

describe("user:list with the tenant feature", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [createUserFeature(), createConfigFeature(), createTenantFeature()],
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a failing membership lookup surfaces instead of an empty tenants column", async () => {
    await seedUser(stack);
    await executeRawQuery(stack.db, "DROP TABLE read_tenant_memberships", []);

    const res = await stack.http.query(UserQueries.list, {}, systemAdmin);

    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  test("a failing membership lookup surfaces on detail too", async () => {
    const id = await seedUser(stack);
    await executeRawQuery(stack.db, "DROP TABLE IF EXISTS read_tenant_memberships", []);

    const res = await stack.http.query(UserQueries.detail, { id }, systemAdmin);

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

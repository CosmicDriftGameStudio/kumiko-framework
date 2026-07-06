import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { CAP_COUNTER_LIST_SCREEN_ID, CapCounterQueries } from "../constants";
import { capCounterEntity } from "../entity";
import { capCounterFeature } from "../feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [capCounterFeature],
  });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("cap-counter access matrix", () => {
  test("cap-list screen and list query are SystemAdmin-only", () => {
    expect(rolesOf(stack.registry.getQueryHandler(CapCounterQueries.list)?.access)).toEqual([
      "SystemAdmin",
    ]);
    const screen = capCounterFeature.screens[CAP_COUNTER_LIST_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });
});

describe("cap-counter list HTTP access", () => {
  test("SystemAdmin can list counters", async () => {
    const admin = createTestUser({ id: 41, roles: ["SystemAdmin"] });
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      CapCounterQueries.list,
      {},
      admin,
    );
    expect(Array.isArray(res.rows)).toBe(true);
  });

  test("TenantAdmin gets 403 on list", async () => {
    const user = createTestUser({ id: 42, roles: ["TenantAdmin"] });
    expect((await stack.http.query(CapCounterQueries.list, {}, user)).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { DELIVERY_LOG_SCREEN_ID, DeliveryQueries } from "../constants";
import { createDeliveryFeature } from "../feature";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createDeliveryFeature()],
  });
  await unsafePushTables(stack.db, { deliveryAttemptsTable, notificationPreferencesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("delivery access matrix", () => {
  test("delivery log handler and screen share access.admin", () => {
    const registry = createRegistry([createDeliveryFeature()]);
    expect(rolesOf(registry.getQueryHandler(DeliveryQueries.log)?.access)).toEqual([
      ...access.admin,
    ]);
    const delivery = createDeliveryFeature();
    const screen = delivery.screens[DELIVERY_LOG_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });
});

describe("delivery log HTTP access", () => {
  test("TenantAdmin can query delivery log", async () => {
    const user = createTestUser({ id: 11, roles: ["TenantAdmin"] });
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      DeliveryQueries.log,
      {},
      user,
    );
    expect(Array.isArray(res.rows)).toBe(true);
  });

  test("historic Admin can query delivery log", async () => {
    const user = createTestUser({ id: 12, roles: ["Admin"] });
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      DeliveryQueries.log,
      {},
      user,
    );
    expect(Array.isArray(res.rows)).toBe(true);
  });

  test("regular User gets 403", async () => {
    const user = createTestUser({ id: 13, roles: ["User"] });
    expect((await stack.http.query(DeliveryQueries.log, {}, user)).status).toBe(403);
  });
});

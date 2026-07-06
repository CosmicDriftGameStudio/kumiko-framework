import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
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

describe("delivery log tenant isolation", () => {
  // delivery runs in system-scope, so the handler must filter by tenantId —
  // otherwise a TenantAdmin reads every tenant's attempts (with decrypted PII).
  test("TenantAdmin only sees their own tenant's delivery attempts", async () => {
    const tenantA = testTenantId(1); // createTestUser default tenant
    const tenantB = testTenantId(2);
    await insertMany(stack.db, deliveryAttemptsTable, [
      {
        id: crypto.randomUUID(),
        tenantId: tenantA,
        notificationType: "welcome",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: crypto.randomUUID(),
        tenantId: tenantB,
        notificationType: "welcome",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
    ]);

    const adminA = createTestUser({ id: 21, roles: ["TenantAdmin"], tenantId: tenantA });
    const res = await stack.http.queryOk<{ rows: readonly { tenantId: string }[] }>(
      DeliveryQueries.log,
      {},
      adminA,
    );

    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(res.rows.some((r) => r.tenantId === tenantB)).toBe(false);
  });
});

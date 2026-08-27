import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, createRegistry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { DELIVERY_LOG_SCREEN_ID, DeliveryHandlers, DeliveryQueries } from "../constants";
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

describe("delivery log SystemAdmin cross-tenant scope", () => {
  // Platform waitlist confirmations are dispatched under SYSTEM_TENANT_ID
  // (anonymous submit). SystemAdmin must see those rows even when their
  // session tenant is a demo tenant; TenantAdmin must not.
  const WAITLIST_CONFIRMATION = "waitlist:notify:confirmation";

  test("SystemAdmin sees waitlist confirmation under SYSTEM_TENANT_ID and other tenants, with tenantId on each row", async () => {
    const demoTenant = testTenantId(51);
    const otherTenant = testTenantId(52);
    const systemConfirmationId = crypto.randomUUID();
    const demoActivationId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const failedConfirmationId = crypto.randomUUID();

    await insertMany(stack.db, deliveryAttemptsTable, [
      {
        id: systemConfirmationId,
        tenantId: SYSTEM_TENANT_ID,
        notificationType: WAITLIST_CONFIRMATION,
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: failedConfirmationId,
        tenantId: SYSTEM_TENANT_ID,
        notificationType: WAITLIST_CONFIRMATION,
        channel: "email",
        recipientAddress: null,
        status: "failed",
        error: "smtp down",
      },
      {
        id: demoActivationId,
        tenantId: demoTenant,
        notificationType: "auth-email-password:signup-activation",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: otherTenantId,
        tenantId: otherTenant,
        notificationType: "welcome",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
    ]);

    // Session on demo tenant — mirrors SystemAdmin browsing a tenant panel.
    const systemAdmin = createTestUser({
      id: 51,
      roles: ["SystemAdmin"],
      tenantId: demoTenant,
    });
    const res = await stack.http.queryOk<{
      rows: readonly {
        id: string;
        tenantId: string;
        type: string;
        status: string;
        error: string | null;
      }[];
    }>(DeliveryQueries.log, { limit: 100 }, systemAdmin);

    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(byId.get(systemConfirmationId)?.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(byId.get(systemConfirmationId)?.type).toBe(WAITLIST_CONFIRMATION);
    expect(byId.get(demoActivationId)?.tenantId).toBe(demoTenant);
    expect(byId.get(otherTenantId)?.tenantId).toBe(otherTenant);

    const failed = byId.get(failedConfirmationId);
    expect(failed?.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(failed?.type).toBe(WAITLIST_CONFIRMATION);
    // Failure path: confirmation delivery errors must surface in the log so
    // SystemAdmin can diagnose SMTP/channel outages (status=failed).
    expect(failed?.status).toBe("failed");

    expect(res.rows.every((r) => typeof r.tenantId === "string" && r.tenantId.length > 0)).toBe(
      true,
    );
  });

  test("SystemAdmin cursor-paginates the unfiltered cross-tenant result set, seeing every row exactly once", async () => {
    const pagingTenant = testTenantId(53);
    const seededRows = Array.from({ length: 7 }, (_, i) => ({
      id: crypto.randomUUID(),
      tenantId: i % 2 === 0 ? SYSTEM_TENANT_ID : pagingTenant,
      // unique per row so we can sort on it — the default sort (createdAt)
      // ties across rows inserted in the same insertMany statement, and the
      // cursor WHERE only excludes strictly-equal sort values (see
      // log.query.ts), so equal timestamps would silently drop rows.
      notificationType: `paging-test:${i}`,
      channel: "email",
      recipientAddress: null,
      status: "sent",
    }));
    await insertMany(stack.db, deliveryAttemptsTable, seededRows);

    const systemAdmin = createTestUser({
      id: 52,
      roles: ["SystemAdmin"],
      tenantId: pagingTenant,
    });

    const seenCounts = new Map<string, number>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await stack.http.queryOk<{
        rows: readonly { id: string }[];
        nextCursor: string | null;
      }>(
        DeliveryQueries.log,
        { limit: 3, sort: "type", sortDirection: "asc", cursor },
        systemAdmin,
      );
      for (const row of page.rows) {
        seenCounts.set(row.id, (seenCounts.get(row.id) ?? 0) + 1);
      }
      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
      expect(pageCount).toBeLessThan(50);
    } while (cursor);

    expect(pageCount).toBeGreaterThan(1);
    for (const row of seededRows) {
      expect(seenCounts.get(row.id)).toBe(1);
    }
    expect([...seenCounts.values()].every((count) => count === 1)).toBe(true);
  });

  test("SystemAdmin with no demo-tenant session (session tenantId is SYSTEM_TENANT_ID itself) still sees cross-tenant rows", async () => {
    const otherTenant = testTenantId(54);
    const systemScopedId = crypto.randomUUID();
    const otherTenantRowId = crypto.randomUUID();

    await insertMany(stack.db, deliveryAttemptsTable, [
      {
        id: systemScopedId,
        tenantId: SYSTEM_TENANT_ID,
        notificationType: "no-session-tenant-test:system",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: otherTenantRowId,
        tenantId: otherTenant,
        notificationType: "no-session-tenant-test:other",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
    ]);

    // Mirrors a platform-level caller (e.g. an API key) that has no demo
    // tenant on its session at all, as opposed to the other SystemAdmin
    // tests above which browse from a demo tenant panel.
    const systemAdmin = createTestUser({
      id: 53,
      roles: ["SystemAdmin"],
      tenantId: SYSTEM_TENANT_ID,
    });

    const res = await stack.http.queryOk<{
      rows: readonly { id: string; tenantId: string }[];
    }>(DeliveryQueries.log, { limit: 100 }, systemAdmin);

    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(byId.get(systemScopedId)?.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(byId.get(otherTenantRowId)?.tenantId).toBe(otherTenant);
  });

  test("TenantAdmin cannot read SYSTEM_TENANT_ID or foreign-tenant delivery attempts", async () => {
    const demoTenant = testTenantId(61);
    const otherTenant = testTenantId(62);
    await insertMany(stack.db, deliveryAttemptsTable, [
      {
        id: crypto.randomUUID(),
        tenantId: SYSTEM_TENANT_ID,
        notificationType: WAITLIST_CONFIRMATION,
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: crypto.randomUUID(),
        tenantId: otherTenant,
        notificationType: "welcome",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
      {
        id: crypto.randomUUID(),
        tenantId: demoTenant,
        notificationType: "welcome",
        channel: "email",
        recipientAddress: null,
        status: "sent",
      },
    ]);

    const tenantAdmin = createTestUser({
      id: 61,
      roles: ["TenantAdmin"],
      tenantId: demoTenant,
    });
    const res = await stack.http.queryOk<{ rows: readonly { tenantId: string }[] }>(
      DeliveryQueries.log,
      {},
      tenantAdmin,
    );

    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.tenantId === demoTenant)).toBe(true);
    expect(res.rows.some((r) => r.tenantId === SYSTEM_TENANT_ID)).toBe(false);
    expect(res.rows.some((r) => r.tenantId === otherTenant)).toBe(false);
  });

  test("tenant User cannot query delivery log (negative authz)", async () => {
    const demoTenant = testTenantId(71);
    const user = createTestUser({ id: 71, roles: ["User"], tenantId: demoTenant });
    expect((await stack.http.query(DeliveryQueries.log, {}, user)).status).toBe(403);
  });
});

describe("delivery preferences tenant isolation", () => {
  // A userId is not tenant-unique — the same person can be a member of
  // several tenants (tenant:write:add-member takes {userId, tenantId}).
  // delivery runs in system-scope, so the preferences query handler must
  // filter by tenantId too — otherwise setting a preference in tenant A
  // leaks into (or gets read from) tenant B for the same userId.
  test("user only sees their own tenant's preference for a shared userId", async () => {
    const tenantA = testTenantId(31);
    const tenantB = testTenantId(32);
    const sharedUser = 41;
    const userInTenantA = createTestUser({ id: sharedUser, roles: ["User"], tenantId: tenantA });
    const userInTenantB = createTestUser({ id: sharedUser, roles: ["User"], tenantId: tenantB });
    expect(userInTenantA.id).toBe(userInTenantB.id);

    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "welcome", channel: "email", enabled: false },
      userInTenantA,
    );
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "welcome", channel: "push", enabled: false },
      userInTenantB,
    );

    const resA = await stack.http.queryOk<{ rows: readonly { channel: string }[] }>(
      DeliveryQueries.preferences,
      {},
      userInTenantA,
    );
    expect(resA.rows.length).toBeGreaterThan(0);
    expect(resA.rows.every((r) => r.channel === "email")).toBe(true);

    const resB = await stack.http.queryOk<{ rows: readonly { channel: string }[] }>(
      DeliveryQueries.preferences,
      {},
      userInTenantB,
    );
    expect(resB.rows.length).toBeGreaterThan(0);
    expect(resB.rows.every((r) => r.channel === "push")).toBe(true);
  });
});

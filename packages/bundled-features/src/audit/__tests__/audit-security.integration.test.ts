// Security integration tests for audit-log HTTP surface.
// Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  createEntity,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { hashPassword } from "../../auth-email-password/password-hashing";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant/feature";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { AUDIT_LOG_SCREEN_ID, AuditQueries } from "../constants";
import { createAuditFeature } from "../feature";

const widgetEntity = createEntity({
  table: "audit_sec_widgets",
  fields: {
    name: createTextField({ required: true }),
  },
});

const widgetFeature = defineFeature("audit-sec-widgets", (r) => {
  r.entity("widget", widgetEntity);
  r.writeHandler(
    defineEntityWriteHandler("widget:create", widgetEntity, {
      access: { roles: ["Admin", "User", "SystemAdmin", "TenantAdmin"] },
    }),
  );
});

let stack: TestStack;
let TENANT_ID: TenantId;
let tenantAdminId: string;

const systemAdmin = TestUsers.systemAdmin;

function tenantAdmin(): SessionUser {
  return { id: tenantAdminId, tenantId: TENANT_ID, roles: ["TenantAdmin"] };
}

function regularUser(): SessionUser {
  return createTestUser({ id: 42, tenantId: TENANT_ID, roles: ["User"] });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      widgetFeature,
      createAuditFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await unsafePushTables(stack.db, { tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`TRUNCATE audit_sec_widgets`);
  TENANT_ID = testTenantId(1);
  await seedTenant(stack.db, { id: TENANT_ID, key: "audit-sec", name: "Audit Sec" });
  ({ id: tenantAdminId } = await seedUser(stack.db, {
    email: "taudit@example.com",
    displayName: "TAudit",
    passwordHash: await hashPassword("pw-audit-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: tenantAdminId,
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
});

describe("access matrix: audit list uses access.admin", () => {
  test("handler and screen share access.admin", () => {
    const adminRoles = [...access.admin];
    expect(rolesOf(stack.registry.getQueryHandler(AuditQueries.list)?.access)).toEqual(adminRoles);
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(adminRoles);
    }
  });
});

describe("TenantAdmin can query audit log for own tenant", () => {
  test("TenantAdmin lists events after write in tenant", async () => {
    await stack.http.writeOk(
      "audit-sec-widgets:write:widget:create",
      { name: "audited" },
      tenantAdmin(),
    );
    const res = await stack.http.queryOk<{ rows: readonly { type: string }[] }>(
      AuditQueries.list,
      {},
      tenantAdmin(),
    );
    expect(res.rows.some((r) => r.type === "widget.created")).toBe(true);
  });
});

describe("regular User denied audit log", () => {
  test("403 on audit:query:list", async () => {
    const res = await stack.http.query(AuditQueries.list, {}, regularUser());
    expect(res.status).toBe(403);
  });
});

describe("systemAdmin retains audit access", () => {
  test("SystemAdmin can list", async () => {
    await stack.http.writeOk("audit-sec-widgets:write:widget:create", { name: "sys" }, systemAdmin);
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      AuditQueries.list,
      {},
      systemAdmin,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
  });
});

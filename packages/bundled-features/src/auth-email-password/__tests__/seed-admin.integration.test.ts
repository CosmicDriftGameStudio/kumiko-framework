// Tests for the seedAdmin convenience API from auth-email-password/testing.
//
// Scope: seedAdmin orchestrates seedTenant × N + seedUserWithPassword +
// seedTenantMembership × N. The individual helpers have their own tests
// (tenant/seed-testing, user/seed-testing). These tests cover only what
// SEEDADMIN itself guarantees:
//   1. The order is correct — tenants before the user before memberships.
//   2. The password is hashed with argon2 and is valid via verifyPassword(plain, hash).
//   3. Re-running is idempotent (for persistent-DB mode in the dev server).
//   4. Roles are assigned correctly per tenant (different role lists per
//      membership).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { verifyPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { seedAdmin } from "../testing.ts";

let stack: TestStack;

const TENANT_DEV: TenantId = "00000000-0000-4000-8000-000000000d11" as TenantId;
const TENANT_BETA: TenantId = "00000000-0000-4000-8000-000000000be1" as TenantId;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    extraContext: { configResolver: resolver },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${eventsTable.tableName}"`);
});

describe("seedAdmin", () => {
  test("legt Tenants, User mit gehashtem Password und Memberships an — Login-Roundtrip funktioniert", async () => {
    const { id: userId } = await seedAdmin(stack.db, {
      email: "admin@example.com",
      password: "secret-pw",
      displayName: "Admin",
      memberships: [
        {
          tenantId: TENANT_DEV,
          tenantKey: "dev",
          tenantName: "Dev",
          roles: ["Admin"],
        },
        {
          tenantId: TENANT_BETA,
          tenantKey: "beta",
          tenantName: "Beta",
          roles: ["User"],
        },
      ],
    });

    // Tenants angelegt
    const tenants = await selectMany(stack.db, tenantTable);
    expect(tenants.map((t) => t["id"]).sort()).toEqual([TENANT_DEV, TENANT_BETA].sort());

    // User created with a hash (NOT the plain password)
    const [user] = await selectMany(stack.db, userTable, { email: "admin@example.com" });
    expect(user?.["id"]).toBe(userId);
    expect(user?.["passwordHash"]).not.toBe("secret-pw");
    expect(user?.["passwordHash"]).toMatch(/^\$argon2/);

    // verifyPassword(hash, plain) — the login path would succeed.
    const valid = await verifyPassword(user?.["passwordHash"] as string, "secret-pw");
    expect(valid).toBe(true);
    const invalid = await verifyPassword(user?.["passwordHash"] as string, "wrong-pw");
    expect(invalid).toBe(false);

    // Memberships per tenant with different roles
    const devMembership = await selectMany(stack.db, tenantMembershipsTable, {
      userId: userId,
      tenantId: TENANT_DEV,
    });
    expect(devMembership[0]?.["roles"]).toBe(JSON.stringify(["Admin"]));

    const betaMembership = await selectMany(stack.db, tenantMembershipsTable, {
      userId: userId,
      tenantId: TENANT_BETA,
    });
    expect(betaMembership[0]?.["roles"]).toBe(JSON.stringify(["User"]));
  });

  test("emailVerified: true wird an seedUserWithPassword durchgereicht", async () => {
    await seedAdmin(stack.db, {
      email: "verified@example.com",
      password: "secret-pw",
      displayName: "Verified Admin",
      emailVerified: true,
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    const [user] = await selectMany(stack.db, userTable, { email: "verified@example.com" });
    expect(user?.["emailVerified"]).toBe(true);
  });

  test("emailVerified: ohne Flag bleibt der User unverifiziert (Default)", async () => {
    await seedAdmin(stack.db, {
      email: "unverified@example.com",
      password: "secret-pw",
      displayName: "Unverified Admin",
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    const [user] = await selectMany(stack.db, userTable, { email: "unverified@example.com" });
    expect(user?.["emailVerified"]).toBe(false);
  });

  test("idempotent: zweiter Aufruf no-op (kein Crash, Stand bleibt)", async () => {
    // Erstaufruf
    const { id: userId1 } = await seedAdmin(stack.db, {
      email: "admin@example.com",
      password: "pw1",
      displayName: "Admin",
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    // Second call — same email, different password (would theoretically
    // create and write a new hash, but the idempotency check
    // runs BEFORE the insert).
    const { id: userId2 } = await seedAdmin(stack.db, {
      email: "admin@example.com",
      password: "pw2",
      displayName: "Admin",
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    expect(userId2).toBe(userId1);

    // Exactly one user row, with the original hash (matches pw1, not pw2).
    const users = await selectMany(stack.db, userTable);
    expect(users).toHaveLength(1);
    const valid = await verifyPassword(users[0]?.["passwordHash"] as string, "pw1");
    expect(valid).toBe(true);
    const invalid = await verifyPassword(users[0]?.["passwordHash"] as string, "pw2");
    expect(invalid).toBe(false);

    // Exactly one membership row.
    const memberships = await selectMany(stack.db, tenantMembershipsTable);
    expect(memberships).toHaveLength(1);

    // Exactly one .created event per aggregate type.
    const events = await selectMany(stack.db, eventsTable);
    const createdByType = events
      .filter((e) => e.type.endsWith(".created"))
      .reduce<Record<string, number>>((acc, e) => {
        acc[e.aggregateType] = (acc[e.aggregateType] ?? 0) + 1;
        return acc;
      }, {});
    expect(createdByType).toEqual({
      tenant: 1,
      user: 1,
      "tenant-membership": 1,
    });
  });
});

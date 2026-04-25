// Tests für die seedAdmin-Convenience aus auth-email-password/testing.
//
// Wert: seedAdmin orchestriert seedTenant × N + seedUserWithPassword +
// seedTenantMembership × N. Die Einzel-Helper haben jeweils eigene Tests
// (tenant/seed-testing, user/seed-testing). Hier prüfen wir nur was
// SEEDADMIN selber zusagt:
//   1. Reihenfolge stimmt — Tenants vor User vor Memberships.
//   2. Password wird mit argon2 gehasht und ist via verifyPassword(plain, hash) gültig.
//   3. Re-Run ist idempotent (für persistent-DB-Modus im dev-server).
//   4. Rollen pro Tenant landen korrekt (unterschiedliche Rollen-Listen
//      pro Membership).

import type { TenantId } from "@kumiko/framework/engine";
import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config/config-feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/tenant-entity";
import { createTenantFeature } from "../../tenant/tenant-feature";
import { userEntity, userTable } from "../../user/user-entity";
import { createUserFeature } from "../../user/user-feature";
import { verifyPassword } from "../password-hashing";
import { seedAdmin } from "../testing";

let stack: TestStack;

const TENANT_DEV: TenantId = "00000000-0000-4000-8000-000000000d11" as TenantId;
const TENANT_BETA: TenantId = "00000000-0000-4000-8000-000000000be1" as TenantId;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    extraContext: { configResolver: resolver },
  });
  await createEntityTable(stack.db, tenantEntity);
  await createEntityTable(stack.db, userEntity);
  await pushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(tenantMembershipsTable);
  await stack.db.delete(tenantTable);
  await stack.db.delete(userTable);
  await stack.db.delete(eventsTable);
});

describe("seedAdmin", () => {
  test("legt Tenants, User mit gehashtem Password und Memberships an — Login-Roundtrip funktioniert", async () => {
    const userId = await seedAdmin(stack.db, {
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
    const tenants = await stack.db.select().from(tenantTable);
    expect(tenants.map((t) => t["id"]).sort()).toEqual([TENANT_DEV, TENANT_BETA].sort());

    // User angelegt mit Hash (NICHT plain-Password)
    const [user] = await stack.db
      .select()
      .from(userTable)
      .where(eq(userTable["email"], "admin@example.com"));
    expect(user?.["id"]).toBe(userId);
    expect(user?.["passwordHash"]).not.toBe("secret-pw");
    expect(user?.["passwordHash"]).toMatch(/^\$argon2/);

    // verifyPassword(hash, plain) — Login-Pfad würde durchgehen.
    const valid = await verifyPassword(user?.["passwordHash"] as string, "secret-pw");
    expect(valid).toBe(true);
    const invalid = await verifyPassword(user?.["passwordHash"] as string, "wrong-pw");
    expect(invalid).toBe(false);

    // Memberships pro Tenant mit unterschiedlichen Rollen
    const devMembership = await stack.db
      .select()
      .from(tenantMembershipsTable)
      .where(
        and(
          eq(tenantMembershipsTable.userId, userId),
          eq(tenantMembershipsTable.tenantId, TENANT_DEV),
        ),
      );
    expect(devMembership[0]?.["roles"]).toBe(JSON.stringify(["Admin"]));

    const betaMembership = await stack.db
      .select()
      .from(tenantMembershipsTable)
      .where(
        and(
          eq(tenantMembershipsTable.userId, userId),
          eq(tenantMembershipsTable.tenantId, TENANT_BETA),
        ),
      );
    expect(betaMembership[0]?.["roles"]).toBe(JSON.stringify(["User"]));
  });

  test("idempotent: zweiter Aufruf no-op (kein Crash, Stand bleibt)", async () => {
    // Erstaufruf
    const userId1 = await seedAdmin(stack.db, {
      email: "admin@example.com",
      password: "pw1",
      displayName: "Admin",
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    // Zweiter Aufruf — gleicher Email, anderes Password (würde theoretisch
    // einen neuen Hash erzeugen und neu schreiben, der idempotent-Check
    // greift VOR dem Insert).
    const userId2 = await seedAdmin(stack.db, {
      email: "admin@example.com",
      password: "pw2",
      displayName: "Admin",
      memberships: [
        { tenantId: TENANT_DEV, tenantKey: "dev", tenantName: "Dev", roles: ["Admin"] },
      ],
    });
    expect(userId2).toBe(userId1);

    // Genau ein User-Row, original-Hash (passt zu pw1, nicht pw2).
    const users = await stack.db.select().from(userTable);
    expect(users).toHaveLength(1);
    const valid = await verifyPassword(users[0]?.["passwordHash"] as string, "pw1");
    expect(valid).toBe(true);
    const invalid = await verifyPassword(users[0]?.["passwordHash"] as string, "pw2");
    expect(invalid).toBe(false);

    // Genau ein Membership-Row.
    const memberships = await stack.db.select().from(tenantMembershipsTable);
    expect(memberships).toHaveLength(1);

    // Genau ein .created-Event pro Aggregat-Typ.
    const events = await stack.db.select().from(eventsTable);
    const createdByType = events
      .filter((e) => e.type.endsWith(".created"))
      .reduce<Record<string, number>>((acc, e) => {
        acc[e.aggregateType] = (acc[e.aggregateType] ?? 0) + 1;
        return acc;
      }, {});
    expect(createdByType).toEqual({
      tenant: 1,
      user: 1,
      tenantMembership: 1,
    });
  });
});

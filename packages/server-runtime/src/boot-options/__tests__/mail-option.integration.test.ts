import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { resolveStoredUserEmail } from "../mail-option.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("default resolveEmail", () => {
  test("finds a user row that carries the system tenant from a handler context of another tenant", async () => {
    await seedRow(testDb.db, userTable, {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: SYSTEM_TENANT_ID,
      email: "system-tenant-user@example.com",
      passwordHash: "hashed",
      displayName: "Sys",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: "active",
    });

    const email = await resolveStoredUserEmail("11111111-1111-4111-8111-111111111111", {
      db: testDb.db,
      tenantId: testTenantId(7),
    });

    expect(email).toBe("system-tenant-user@example.com");
  });

  test("returns null for an unknown user id", async () => {
    const email = await resolveStoredUserEmail("22222222-2222-4222-8222-222222222222", {
      db: testDb.db,
      tenantId: testTenantId(7),
    });

    expect(email).toBeNull();
  });
});

// tenant:query:member-directory backs every `user:user` reference label
// (fw#3107). It replaced the SystemAdmin-only user:query:user:list as lookup
// source, so the invariants that matter: a TenantAdmin reaches it, sees only
// their own tenant and gets no more than id + display name, while a SystemAdmin
// keeps the global reach the roster gave them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { REFERENCE_LOOKUP_SOURCES } from "@cosmicdrift/kumiko-framework/ui-types";
import { createConfigFeature } from "../../config";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantMembershipsTable } from "../membership-table";
import { tenantEntity } from "../schema/tenant";
import { seedTenant, seedTenantMembership } from "../seeding";

const ownTenantId = testTenantId(1);
const foreignTenantId = testTenantId(2);

type DirectoryRow = Readonly<Record<string, unknown>>;

let stack: TestStack;

function tenantAdmin(userId: string): SessionUser {
  return { id: userId, tenantId: ownTenantId, roles: ["TenantAdmin"] };
}

async function seedMember(
  tenantId: string,
  displayName: string,
  roles: readonly string[],
): Promise<string> {
  const { id } = await seedUser(stack.db, {
    email: `${displayName.toLowerCase().replace(/\s+/g, "-")}@example.com`,
    displayName,
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId, roles: [...roles] });
  return id;
}

async function queryDirectory(caller: SessionUser): Promise<readonly DirectoryRow[]> {
  const result = await stack.http.queryOk<{ rows: readonly DirectoryRow[] }>(
    TenantQueries.memberDirectory,
    {},
    caller,
  );
  return result.rows;
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable]);
  await seedTenant(stack.db, { id: ownTenantId, key: "directory-own", name: "Own Tenant" });
  await seedTenant(stack.db, {
    id: foreignTenantId,
    key: "directory-foreign",
    name: "Foreign Tenant",
  });
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant:query:member-directory (fw#3107)", () => {
  test("is the lookup source the renderer uses for user:user references", () => {
    expect(REFERENCE_LOOKUP_SOURCES["user:user"]).toEqual({
      queryQn: TenantQueries.memberDirectory,
      labelKey: "label",
    });
  });

  test("a TenantAdmin gets their own members as id/label, never a foreign-tenant user", async () => {
    const adminId = await seedMember(ownTenantId, "Own Admin", ["TenantAdmin"]);
    const colleagueId = await seedMember(ownTenantId, "Own Colleague", ["User"]);
    const foreignId = await seedMember(foreignTenantId, "Foreign Person", ["TenantAdmin"]);

    const rows = await queryDirectory(tenantAdmin(adminId));

    const byId = new Map(rows.map((row) => [String(row["id"]), row]));
    expect(byId.get(adminId)?.["label"]).toBe("Own Admin");
    expect(byId.get(colleagueId)?.["label"]).toBe("Own Colleague");
    expect(byId.has(foreignId)).toBe(false);
    expect(rows.length).toBe(2);
  });

  test("rows carry only id and label — no email or roles leave the directory", async () => {
    const adminId = await seedMember(ownTenantId, "Own Admin", ["TenantAdmin"]);

    const rows = await queryDirectory(tenantAdmin(adminId));

    expect(rows.map((row) => Object.keys(row).sort())).toEqual([["id", "label"]]);
  });

  test("a user shared with a foreign tenant is still listed once, under the display name", async () => {
    const adminId = await seedMember(ownTenantId, "Own Admin", ["TenantAdmin"]);
    const sharedId = await seedMember(foreignTenantId, "Shared Person", ["User"]);
    await seedTenantMembership(stack.db, {
      userId: sharedId,
      tenantId: ownTenantId,
      roles: ["User"],
    });

    const rows = await queryDirectory(tenantAdmin(adminId));

    expect(rows.filter((row) => row["id"] === sharedId)).toEqual([
      { id: sharedId, label: "Shared Person" },
    ]);
  });

  test("display names come back decrypted when a PII-subject KMS is active", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const adminId = await seedMember(ownTenantId, "Encrypted Admin", ["TenantAdmin"]);

    const rows = await queryDirectory(tenantAdmin(adminId));

    expect(rows).toEqual([{ id: adminId, label: "Encrypted Admin" }]);
  });

  test("a SystemAdmin without membership in the active tenant still resolves every user, themselves included", async () => {
    const memberId = await seedMember(ownTenantId, "Own Colleague", ["User"]);
    const foreignId = await seedMember(foreignTenantId, "Foreign Person", ["User"]);
    const { id: operatorId } = await seedUser(stack.db, {
      email: "operator@example.com",
      displayName: "Platform Operator",
      emailVerified: true,
    });

    const rows = await queryDirectory({
      id: operatorId,
      tenantId: ownTenantId,
      roles: ["SystemAdmin"],
    });

    const labelById = new Map(rows.map((row) => [String(row["id"]), row["label"]]));
    expect(labelById.get(operatorId)).toBe("Platform Operator");
    expect(labelById.get(memberId)).toBe("Own Colleague");
    expect(labelById.get(foreignId)).toBe("Foreign Person");
  });

  test("a plain member without an admin role is refused", async () => {
    await seedMember(ownTenantId, "Own Admin", ["TenantAdmin"]);
    const memberId = await seedMember(ownTenantId, "Plain Member", ["User"]);

    const res = await stack.http.query(
      TenantQueries.memberDirectory,
      {},
      { id: memberId, tenantId: ownTenantId, roles: ["User"] },
    );

    expect(res.status).toBe(403);
  });
});

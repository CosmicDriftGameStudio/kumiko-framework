// tenant:query:tenant-directory backs every `tenant:tenant` reference label
// (fw#3142). It replaced the SystemAdmin-only tenant:query:tenant:list as
// lookup source, so the invariants that matter: a TenantAdmin reaches it and
// sees only their own tenant, while a SystemAdmin keeps the global reach the
// entity-convention list gave them.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { REFERENCE_LOOKUP_SOURCES } from "@cosmicdrift/kumiko-framework/ui-types";
import { createConfigFeature } from "../../config";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantEntity } from "../schema/tenant";
import { seedTenant } from "../seeding";

const ownTenantId = testTenantId(1);
const foreignTenantId = testTenantId(2);

type DirectoryRow = Readonly<Record<string, unknown>>;

let stack: TestStack;

function tenantAdmin(userId: string): SessionUser {
  return { id: userId, tenantId: ownTenantId, roles: ["TenantAdmin"] };
}

async function queryDirectory(caller: SessionUser): Promise<readonly DirectoryRow[]> {
  const result = await stack.http.queryOk<{ rows: readonly DirectoryRow[] }>(
    TenantQueries.tenantDirectory,
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
  await unsafePushTables(stack.db, { configValuesTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable]);
  await seedTenant(stack.db, { id: ownTenantId, key: "directory-own", name: "Own Tenant" });
  await seedTenant(stack.db, {
    id: foreignTenantId,
    key: "directory-foreign",
    name: "Foreign Tenant",
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant:query:tenant-directory (fw#3142)", () => {
  test("is the lookup source the renderer uses for tenant:tenant references", () => {
    expect(REFERENCE_LOOKUP_SOURCES["tenant:tenant"]).toEqual({
      queryQn: TenantQueries.tenantDirectory,
      labelKey: "label",
    });
  });

  test("a TenantAdmin gets only their own tenant as id/label", async () => {
    const { id: adminId } = await seedUser(stack.db, {
      email: "own-admin@example.com",
      displayName: "Own Admin",
      emailVerified: true,
    });

    const rows = await queryDirectory(tenantAdmin(adminId));

    expect(rows).toEqual([{ id: ownTenantId, label: "Own Tenant" }]);
  });

  test("a SystemAdmin without membership in the active tenant still resolves every tenant", async () => {
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
    expect(labelById.get(ownTenantId)).toBe("Own Tenant");
    expect(labelById.get(foreignTenantId)).toBe("Foreign Tenant");
  });

  test("a plain member without an admin role is refused", async () => {
    const { id: memberId } = await seedUser(stack.db, {
      email: "plain-member@example.com",
      displayName: "Plain Member",
      emailVerified: true,
    });

    const res = await stack.http.query(
      TenantQueries.tenantDirectory,
      {},
      { id: memberId, tenantId: ownTenantId, roles: ["User"] },
    );

    expect(res.status).toBe(403);
  });
});

// tenant:query:tenant-directory backs every `tenant:tenant` reference label.
// It replaced the SystemAdmin-only tenant:query:tenant:list as the lookup
// source, so the invariants that matter: a TenantAdmin reaches it and sees
// only their own tenant, while a SystemAdmin keeps the global reach the
// entity-convention list gave them.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { REFERENCE_LOOKUP_SOURCES } from "@cosmicdrift/kumiko-framework/ui-types";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantEntity } from "../schema/tenant.ts";
import { seedTenant } from "../seeding.ts";
import { TenantQueries } from "../web/constants.ts";

const ownTenantId = testTenantId(1);
const foreignTenantId = testTenantId(2);

type DirectoryRow = Readonly<Record<string, unknown>>;

let stack: TestStack;

function tenantAdmin(userId: string): SessionUser {
  return { id: userId, tenantId: ownTenantId, roles: ["TenantAdmin"] };
}

async function queryDirectory(
  caller: SessionUser,
  payload: Record<string, unknown> = {},
): Promise<readonly DirectoryRow[]> {
  const result = await stack.http.queryOk<{ rows: readonly DirectoryRow[] }>(
    TenantQueries.tenantDirectory,
    payload,
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
  await resetTestTables(stack.db, [userTable, eventsTable]);
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

describe("tenant:query:tenant-directory", () => {
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

  test("ids resolve exactly those tenants for a SystemAdmin and only the own one for a TenantAdmin", async () => {
    const { id: operatorId } = await seedUser(stack.db, {
      email: "ids-operator@example.com",
      displayName: "Ids Operator",
      emailVerified: true,
    });
    const operator: SessionUser = { id: operatorId, tenantId: ownTenantId, roles: ["SystemAdmin"] };

    expect(await queryDirectory(operator, { ids: [foreignTenantId] })).toEqual([
      { id: foreignTenantId, label: "Foreign Tenant" },
    ]);
    expect(await queryDirectory(operator, { ids: [] })).toEqual([]);
    expect(await queryDirectory(tenantAdmin(operatorId), { ids: [foreignTenantId] })).toEqual([]);
  });

  test("a SystemAdmin search narrows the labels case-insensitively", async () => {
    const { id: operatorId } = await seedUser(stack.db, {
      email: "search-operator@example.com",
      displayName: "Search Operator",
      emailVerified: true,
    });

    const rows = await queryDirectory(
      { id: operatorId, tenantId: ownTenantId, roles: ["SystemAdmin"] },
      { search: "foreign" },
    );

    expect(rows).toEqual([{ id: foreignTenantId, label: "Foreign Tenant" }]);
  });

  test("a SystemAdmin limit caps the rows without a search", async () => {
    const { id: operatorId } = await seedUser(stack.db, {
      email: "limit-operator@example.com",
      displayName: "Limit Operator",
      emailVerified: true,
    });

    const rows = await queryDirectory(
      { id: operatorId, tenantId: ownTenantId, roles: ["SystemAdmin"] },
      { limit: 1 },
    );

    expect(rows).toEqual([{ id: foreignTenantId, label: "Foreign Tenant" }]);
  });

  test("a SystemAdmin search with limit 1 returns exactly one of several matches", async () => {
    const { id: operatorId } = await seedUser(stack.db, {
      email: "search-limit-operator@example.com",
      displayName: "Search Limit Operator",
      emailVerified: true,
    });

    const rows = await queryDirectory(
      { id: operatorId, tenantId: ownTenantId, roles: ["SystemAdmin"] },
      { limit: 1, search: "tenant" },
    );

    expect(rows).toEqual([{ id: foreignTenantId, label: "Foreign Tenant" }]);
  });

  test("a search stops decrypting once enough names matched", async () => {
    const { id: operatorId } = await seedUser(stack.db, {
      email: "decrypt-bound-operator@example.com",
      displayName: "Decrypt Bound Operator",
      emailVerified: true,
    });
    // Each tenant name is its own PII subject, so one DEK fetch is one decrypted name.
    class CountingKmsAdapter extends InMemoryKmsAdapter {
      getKeyCalls = 0;

      override async getKey(subject: SubjectId) {
        this.getKeyCalls++;
        return super.getKey(subject);
      }
    }
    const kms = new CountingKmsAdapter();
    configurePiiSubjectKms(kms);
    try {
      const bulkCount = 12;
      for (let n = 1; n <= bulkCount; n++) {
        await seedTenant(stack.db, {
          id: testTenantId(100 + n),
          key: `directory-bulk-${String(n).padStart(2, "0")}`,
          name: `Bulk ${n}`,
        });
      }

      kms.getKeyCalls = 0;
      const rows = await queryDirectory(
        { id: operatorId, tenantId: ownTenantId, roles: ["SystemAdmin"] },
        { limit: 2, search: "bulk" },
      );

      expect(rows).toHaveLength(2);
      expect(kms.getKeyCalls).toBeGreaterThanOrEqual(2);
      expect(kms.getKeyCalls).toBeLessThan(bulkCount);
    } finally {
      resetPiiSubjectKmsForTests();
    }
  });

  test("a TenantAdmin search only matches their own tenant, never a foreign one", async () => {
    const { id: adminId } = await seedUser(stack.db, {
      email: "search-admin@example.com",
      displayName: "Search Admin",
      emailVerified: true,
    });

    expect(await queryDirectory(tenantAdmin(adminId), { search: "OWN" })).toEqual([
      { id: ownTenantId, label: "Own Tenant" },
    ]);
    expect(await queryDirectory(tenantAdmin(adminId), { search: "foreign", limit: 50 })).toEqual(
      [],
    );
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

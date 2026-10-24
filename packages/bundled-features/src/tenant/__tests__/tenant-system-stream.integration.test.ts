// Tenant aggregates are tenant-independent: stream, projection row and search bucket live on
// SYSTEM_TENANT_ID no matter which session tenant the SystemAdmin acts from.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { SEARCH_CONSUMER_NAME } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  drainEventConsumers,
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
import { tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";
import { seedTenant, seedTenantMembership } from "../seeding.ts";
import { TenantHandlers, TenantQueries } from "../web/constants.ts";

const sessionTenantId = testTenantId(7);
const actorInOtherTenant: SessionUser = { ...TestUsers.systemAdmin, tenantId: sessionTenantId };

const LIST = "tenant:query:tenant:list";
const DETAIL = "tenant:query:tenant:detail";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    searchConfig: {
      tenantId: SYSTEM_TENANT_ID,
      searchableFields: ["name"],
      rankingFields: ["name"],
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, tenantTable, eventsTable]);
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

type Detail = { id: string; name: string; isEnabled: boolean; version: number };

async function detail(id: string): Promise<Detail> {
  return stack.http.queryOk<Detail>(DETAIL, { id }, actorInOtherTenant);
}

async function searchIds(term: string): Promise<string[]> {
  await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
  const result = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
    LIST,
    { search: term },
    actorInOtherTenant,
  );
  return result.rows.map((row) => row.id);
}

async function streamTenantsOf(aggregateId: string): Promise<string[]> {
  const events = await selectMany<{ tenantId: string }>(stack.db, eventsTable, { aggregateId });
  return [...new Set(events.map((event) => event.tenantId))];
}

describe("SystemAdmin acting from a foreign session tenant", () => {
  test("create, search, rename, disable and enable all address the SYSTEM stream", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TenantHandlers.create,
      { key: "zephyr", name: "Zephyr Logistics" },
      actorInOtherTenant,
    );
    const id = created.id;

    expect(await streamTenantsOf(id)).toEqual([SYSTEM_TENANT_ID]);
    const rows = await selectMany<{ tenantId: string }>(stack.db, tenantTable, { id });
    expect(rows.map((row) => row.tenantId)).toEqual([SYSTEM_TENANT_ID]);

    expect(await searchIds("zephyr")).toEqual([id]);

    const before = await detail(id);
    await stack.http.writeOk(
      TenantHandlers.update,
      { id, version: before.version, changes: { name: "Borealis Freight" } },
      actorInOtherTenant,
    );
    const renamed = await detail(id);
    expect(renamed.name).toBe("Borealis Freight");
    expect(renamed.version).toBe(before.version + 1);
    expect(await searchIds("borealis")).toEqual([id]);
    expect(await searchIds("zephyr")).toEqual([]);

    await stack.http.writeOk(TenantHandlers.disable, { id }, actorInOtherTenant);
    const disabled = await detail(id);
    expect(disabled.isEnabled).toBe(false);
    expect(disabled.version).toBe(renamed.version + 1);

    await stack.http.writeOk(TenantHandlers.enable, { id }, actorInOtherTenant);
    const enabled = await detail(id);
    expect(enabled.isEnabled).toBe(true);
    expect(enabled.version).toBe(disabled.version + 1);

    expect(await streamTenantsOf(id)).toEqual([SYSTEM_TENANT_ID]);
  });
});

describe("global tenancy does not widen what a tenant admin sees", () => {
  test("tenant-directory and me expose only the caller's own tenant to a plain member", async () => {
    const own = testTenantId(21);
    const foreign = testTenantId(22);
    await seedTenant(stack.db, { id: own, key: "own-co", name: "Own Co" });
    await seedTenant(stack.db, { id: foreign, key: "foreign-co", name: "Foreign Co" });
    const userId = TestUsers.user.id;
    await seedTenantMembership(stack.db, { userId, tenantId: own, roles: ["Admin"] });

    const member: SessionUser = { ...TestUsers.user, tenantId: own, roles: ["Admin"] };

    const me = await stack.http.queryOk<{ id: string } | null>(TenantQueries.me, {}, member);
    expect(me?.id).toBe(own);

    const directory = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
      TenantQueries.tenantDirectory,
      {},
      member,
    );
    expect(directory.rows.map((row) => row.id)).toEqual([own]);
  });
});

describe("seed defaults address the SYSTEM stream", () => {
  const seededId = testTenantId(51);

  test("seedTenant without `by` writes the tenant to SYSTEM", async () => {
    await seedTenant(stack.db, { id: seededId, key: "seeded", name: "Seeded Co" });
    expect(await streamTenantsOf(seededId)).toEqual([SYSTEM_TENANT_ID]);
    const rows = await selectMany<{ tenantId: string }>(stack.db, tenantTable, { id: seededId });
    expect(rows.map((row) => row.tenantId)).toEqual([SYSTEM_TENANT_ID]);
  });

  test("seedTenant with a foreign-tenant `by` still writes to SYSTEM", async () => {
    await seedTenant(stack.db, {
      id: seededId,
      key: "seeded",
      name: "Seeded Co",
      by: createSystemUser(sessionTenantId),
    });
    expect(await streamTenantsOf(seededId)).toEqual([SYSTEM_TENANT_ID]);
    const rows = await selectMany<{ tenantId: string }>(stack.db, tenantTable, { id: seededId });
    expect(rows.map((row) => row.tenantId)).toEqual([SYSTEM_TENANT_ID]);
  });

  test("seedUser without `by` persists the write-gated fields on the SYSTEM stream", async () => {
    const { id } = await seedUser(stack.db, {
      email: "gated@example.com",
      displayName: "Gated",
      roles: ["SystemAdmin"],
      emailVerified: true,
      passwordHash: "hash-value",
    });
    expect(await streamTenantsOf(id)).toEqual([SYSTEM_TENANT_ID]);
    const [row] = await selectMany<{ emailVerified: boolean; passwordHash: string }>(
      stack.db,
      userTable,
      { id },
    );
    expect(row?.emailVerified).toBe(true);
    expect(row?.passwordHash).toBe("hash-value");
  });
});

describe("global tenancy keeps the tenant list surface closed to non-SystemAdmins", () => {
  const own = testTenantId(61);
  const foreign = testTenantId(62);

  async function seedTwoTenants(): Promise<void> {
    await seedTenant(stack.db, { id: own, key: "own-co", name: "Own Co" });
    await seedTenant(stack.db, { id: foreign, key: "foreign-co", name: "Foreign Co" });
    await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
  }

  const tenantAdmin: SessionUser = { ...TestUsers.user, tenantId: own, roles: ["TenantAdmin"] };
  const plainMember: SessionUser = { ...TestUsers.user, tenantId: own, roles: ["User"] };

  test("tenant:query:list and tenant:query:tenant:list answer 403, search included", async () => {
    await seedTwoTenants();
    for (const actor of [tenantAdmin, plainMember]) {
      for (const [label, qn, payload] of [
        ["list", TenantQueries.list, {}],
        ["list search", TenantQueries.list, { search: "foreign" }],
        ["entity list", LIST, {}],
        ["entity list search", LIST, { search: "foreign" }],
      ] as const) {
        const res = await stack.http.query(qn, payload, actor);
        expect(res.status, `${actor.roles.join()} ${label}`).toBe(403);
      }
    }
  });

  test("tenant-directory returns only the caller's tenant to a TenantAdmin", async () => {
    await seedTwoTenants();
    const everything = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
      TenantQueries.tenantDirectory,
      { limit: 50 },
      tenantAdmin,
    );
    expect(everything.rows.map((row) => row.id)).toEqual([own]);
    const searched = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
      TenantQueries.tenantDirectory,
      { search: "foreign", limit: 50 },
      tenantAdmin,
    );
    expect(searched.rows).toEqual([]);
  });
});

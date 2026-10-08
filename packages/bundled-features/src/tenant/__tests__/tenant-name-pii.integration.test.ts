// tenant.name is personal data (signup used to default it to the owner's
// email): encrypted under the tenant record itself, because tenant events
// live in the writer's (system) stream and `personal: "tenant"` would not
// resolve to the tenant being written. These tests pin the ciphertext at
// rest (projection AND event payload), the plaintext on every raw-read
// query path, and the backfill of pre-KMS plaintext events.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { backfillEventPiiEncryption, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createConfigFeature } from "../../config/index.js";
import { configValuesTable } from "../../config/table.js";
import { decryptStoredPii } from "../../shared/index.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { seedUser } from "../../user/seeding.js";
import { TenantHandlers, TenantQueries } from "../constants.js";
import { createTenantFeature } from "../feature.js";
import { tenantMembershipsTable } from "../membership-table.js";
import { tenantEntity, tenantTable } from "../schema/tenant.js";
import { seedTenantMembership } from "../seeding.js";

const systemAdmin = TestUsers.systemAdmin;

let stack: TestStack;

async function createTenant(key: string, name: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key, name },
    systemAdmin,
  );
  return created.id;
}

async function rawTenantName(tenantId: string): Promise<unknown> {
  const rows = await selectMany<{ name: unknown }>(stack.db, tenantTable, { id: tenantId });
  return rows[0]?.name;
}

async function eventNames(tenantId: string): Promise<unknown[]> {
  const events = await selectMany<{ payload: Record<string, unknown> }>(stack.db, eventsTable, {
    aggregateId: tenantId,
  });
  return events.map((event) => event.payload["name"]).filter((name) => name !== undefined);
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
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, tenantTable, eventsTable]);
  resetPiiSubjectKmsForTests();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant.name encryption at rest", () => {
  test("tenant:write:create without an id encrypts projection and event under the tenant record", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const tenantId = await createTenant("pii-acme", "Secret Name GmbH");

    const stored = await rawTenantName(tenantId);
    expect(isPiiCiphertext(stored)).toBe(true);
    expect(String(stored)).toContain(`record:tenant:${tenantId}`);
    expect(String(stored)).not.toContain("Secret Name GmbH");

    const names = await eventNames(tenantId);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(isPiiCiphertext(name)).toBe(true);
      expect(String(name)).toContain(`record:tenant:${tenantId}`);
    }

    expect(await decryptStoredPii(String(stored), "name", "test")).toBe("Secret Name GmbH");
  });

  test("tenant:query:me returns the decrypted name", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const tenantId = await createTenant("pii-me", "Me Tenant");
    const { id: userId } = await seedUser(stack.db, {
      email: "me@example.com",
      displayName: "Me",
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, { userId, tenantId, roles: ["TenantAdmin"] });

    const me = await stack.http.queryOk<{ name: string; key: string } | null>(
      TenantQueries.me,
      {},
      { id: userId, tenantId, roles: ["TenantAdmin"] },
    );

    expect(me?.name).toBe("Me Tenant");
    expect(me?.key).toBe("pii-me");
  });
});

describe("tenant.name raw reads across tenants", () => {
  test("memberships lists the plaintext name of every tenant the user belongs to", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const tenantA = await createTenant("pii-multi-a", "Alpha Holding");
    const tenantB = await createTenant("pii-multi-b", "Beta Works");
    const { id: userId } = await seedUser(stack.db, {
      email: "multi@example.com",
      displayName: "Multi",
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, { userId, tenantId: tenantA, roles: ["User"] });
    await seedTenantMembership(stack.db, { userId, tenantId: tenantB, roles: ["User"] });
    expect(isPiiCiphertext(await rawTenantName(tenantA))).toBe(true);

    const memberships = await stack.http.queryOk<
      readonly { tenantId: string; tenantName?: string; tenantKey?: string }[]
    >(TenantQueries.memberships, { userId }, systemAdmin);

    const nameByTenant = new Map(memberships.map((m) => [m.tenantId, m.tenantName]));
    expect(nameByTenant.get(tenantA)).toBe("Alpha Holding");
    expect(nameByTenant.get(tenantB)).toBe("Beta Works");
  });

  test("tenant-directory finds a tenant by its plaintext name and sorts labels by name", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    // Keys sort opposite to the names so the label order proves the in-memory sort.
    const zulu = await createTenant("pii-dir-a", "Zulu Logistics");
    const alpha = await createTenant("pii-dir-b", "Alpha Logistics");
    const caller: SessionUser = { ...systemAdmin, tenantId: testTenantId(1) };

    const all = await stack.http.queryOk<{ rows: readonly { id: string; label: string }[] }>(
      TenantQueries.tenantDirectory,
      {},
      caller,
    );
    expect(all.rows.map((row) => row.label)).toEqual(["Alpha Logistics", "Zulu Logistics"]);

    const found = await stack.http.queryOk<{ rows: readonly { id: string; label: string }[] }>(
      TenantQueries.tenantDirectory,
      { search: "zulu" },
      caller,
    );
    expect(found.rows).toEqual([{ id: zulu, label: "Zulu Logistics" }]);
    expect(all.rows.find((row) => row.label === "Alpha Logistics")?.id).toBe(alpha);
  });
});

describe("tenant.name backfill", () => {
  test("a plaintext pre-KMS tenant event is encrypted under the tenant record", async () => {
    const tenantId = await createTenant("pii-legacy", "Legacy Plaintext Inc");
    expect(await eventNames(tenantId)).toEqual(["Legacy Plaintext Inc"]);
    expect(await rawTenantName(tenantId)).toBe("Legacy Plaintext Inc");

    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const result = await backfillEventPiiEncryption(stack.db, stack.registry);

    expect(result.failures).toEqual([]);
    const names = await eventNames(tenantId);
    expect(names).toHaveLength(1);
    expect(isPiiCiphertext(names[0])).toBe(true);
    expect(String(names[0])).toContain(`record:tenant:${tenantId}`);
    expect(await decryptStoredPii(String(names[0]), "name", "test")).toBe("Legacy Plaintext Inc");
  });

  test("a tenant destroyed before the backfill is erased, not encrypted under a fresh key", async () => {
    const tenantId = await createTenant("pii-destroyed", "Destroyed Legacy GmbH");
    await updateRows(
      stack.db,
      tenantTable,
      { status: "destroyed", destroyedAt: Temporal.Instant.from("2026-01-15T00:00:00Z") },
      { id: tenantId },
    );

    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const result = await backfillEventPiiEncryption(stack.db, stack.registry);

    expect(result.failures).toEqual([]);
    expect(await eventNames(tenantId)).toEqual([PII_ERASED_SENTINEL]);
  });
});

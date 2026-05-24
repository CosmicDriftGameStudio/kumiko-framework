// S2.U7 — my-audit-log + invalid-attempt-audit + list-download-attempts.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertMany, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { USER_STATUS, userEntity, userTable } from "../../user";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsFeature } from "../feature";
import { downloadAttemptEntity, downloadAttemptsTable } from "../schema/download-attempt";

const MY_AUDIT = "user-data-rights:query:my-audit-log";
const LIST_ATTEMPTS = "user-data-rights:query:list-download-attempts";

let stack: TestStack;

const tenantA = testTenantId(1);
const alice = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const bob = createTestUser({ id: 43, tenantId: tenantA, roles: ["Member"] });
const admin = createTestUser({ id: 1, tenantId: tenantA, roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, downloadAttemptEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_compliance_profiles`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_download_attempts`);
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
});

async function seedUser(u: typeof alice, email: string): Promise<void> {
  await insertOne(stack.db, userTable, {
    id: u.id,
    tenantId: u.tenantId,
    email,
    passwordHash: "h",
    displayName: email,
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
}

let _eventVersion = 0;
async function seedEvent(
  createdBy: string,
  tenantId: string,
  type: string,
  payload: object,
): Promise<void> {
  _eventVersion += 1;
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO kumiko_events
    (tenant_id, aggregate_type, aggregate_id, version, type, payload, metadata, created_at, created_by)
    VALUES ($1, $2, $3,
            $4, $5, $6, $7, now(), $8)
  `,
    [
      tenantId,
      "test-aggregate",
      "00000000-0000-4000-8000-00000000aaaa",
      _eventVersion,
      type,
      JSON.stringify(payload),
      "{}",
      createdBy,
    ],
  );
}

describe("my-audit-log", () => {
  test("user sieht nur seine eigenen events (cross-user-Isolation)", async () => {
    await seedEvent(alice.id, tenantA, "user.requested-deletion", { foo: "alice" });
    await seedEvent(bob.id, tenantA, "user.requested-deletion", { foo: "bob" });

    const aliceLog = await stack.http.queryOk<{ rows: Array<{ payload: unknown }> }>(
      MY_AUDIT,
      {},
      alice,
    );
    const bobLog = await stack.http.queryOk<{ rows: Array<{ payload: unknown }> }>(
      MY_AUDIT,
      {},
      bob,
    );
    expect(aliceLog.rows.length).toBe(1);
    expect(bobLog.rows.length).toBe(1);
    // Payload-pinning beweist die Cross-User-Filterung: alice sieht nur
    // ihre Payload, bob nur seine.
    expect((aliceLog.rows[0]?.payload as { foo: string }).foo).toBe("alice");
    expect((bobLog.rows[0]?.payload as { foo: string }).foo).toBe("bob");
  });

  test("Account-weite Sicht: User sieht events aus anderen Tenants (DSGVO Art. 15)", async () => {
    const tenantB = testTenantId(2);
    await seedEvent(alice.id, tenantA, "user.x", { from: "tenantA" });
    await seedEvent(alice.id, tenantB, "user.y", { from: "tenantB" });

    const log = await stack.http.queryOk<{
      rows: Array<{ payload: { from: string } }>;
    }>(MY_AUDIT, {}, alice);

    expect(log.rows.length).toBe(2);
    const fromTenants = log.rows.map((r) => r.payload.from).sort();
    expect(fromTenants).toEqual(["tenantA", "tenantB"]);
  });

  test("filter eventType + payload kommt mit", async () => {
    await seedEvent(alice.id, tenantA, "user.requested-deletion", { gracePeriodEnd: "2026-06-01" });
    await seedEvent(alice.id, tenantA, "user.lifted-restriction", {});

    const filtered = await stack.http.queryOk<{ rows: Array<{ type: string }> }>(
      MY_AUDIT,
      { eventType: "user.requested-deletion" },
      alice,
    );
    expect(filtered.rows.length).toBe(1);
    expect(filtered.rows[0]?.type).toBe("user.requested-deletion");
  });
});

describe("download-attempt retention :: disk-bomb-Schutz bei Brute-Force", () => {
  test("Entity-Default ist 90d hardDelete (kein unbounded growth)", () => {
    expect(downloadAttemptEntity.retention).toBeDefined();
    expect(downloadAttemptEntity.retention?.keepFor).toBe("90d");
    expect(downloadAttemptEntity.retention?.strategy).toBe("hardDelete");
    expect(downloadAttemptEntity.retention?.reference).toBe("attemptedAt");
  });
});

describe("list-download-attempts (DPO operator-query)", () => {
  test("Admin kann queryen, Member nicht", async () => {
    await seedUser(alice, "alice@example.com");
    // Admin allowed
    const ok = await stack.http.queryOk<{ rows: unknown[] }>(LIST_ATTEMPTS, {}, admin);
    expect(Array.isArray(ok.rows)).toBe(true);
    // Member blocked
    const res = await stack.http.query(LIST_ATTEMPTS, {}, alice);
    expect([401, 403]).toContain(res.status);
  });

  test("filter result=notFound", async () => {
    // Direct-INSERT in attempts (simuliert was die download-handler schreiben).
    const T = await import("@cosmicdrift/kumiko-framework/time");
    const now = T.getTemporal().Now.instant();
    await insertMany(stack.db, downloadAttemptsTable, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenantId: tenantA,
        result: "notFound",
        via: "token",
        tokenHash: "abc",
        jobId: null,
        attemptedByUserId: null,
        ip: "1.2.3.4",
        userAgent: "test",
        attemptedAt: now,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        tenantId: tenantA,
        result: "expired",
        via: "token",
        tokenHash: "def",
        jobId: null,
        attemptedByUserId: null,
        ip: "1.2.3.4",
        userAgent: "test",
        attemptedAt: now,
      },
    ]);

    const filtered = await stack.http.queryOk<{ rows: Array<{ result: string }> }>(
      LIST_ATTEMPTS,
      { result: "notFound" },
      admin,
    );
    expect(filtered.rows.length).toBe(1);
    expect(filtered.rows[0]?.result).toBe("notFound");
  });
});

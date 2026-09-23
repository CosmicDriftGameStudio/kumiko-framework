// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a hand-built
// TenantDb hides the escapeHatch grant the "app-data" stage actually resolves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append, isStreamArchived, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory";
import { tenantMembershipEntity } from "../../tenant";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy";
import { InboundMailFoundationHandlers } from "../constants";
import { seenMessageEntity, syncCursorEntity } from "../entities";
import { inboundMailFoundationFeature } from "../feature";
import { mailAccountsProjectionTable } from "../projection";

let stack: TestStack;
let db: DbConnection;

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

const tenantA = adminFor(9101);
const tenantB = adminFor(9102);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      inboundMailFoundationFeature,
      inboundProviderInMemoryFeature,
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  stack.events.reset();
  await resetTestTables(db, [tenantTable, tenantComplianceProfileTable]);
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, read_mail_accounts RESTART IDENTITY CASCADE`);
});

async function seedTenant(user: typeof tenantA): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    "compliance-profiles:write:set-profile",
    { profileKey: "eu-dsgvo" },
    user,
  );
}

async function seedMailAccount(user: typeof tenantA, address: string): Promise<string> {
  const result = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team-Inbox",
      address,
      scope: "shared",
    },
    user,
  )) as { accountId: string };
  return result.accountId;
}

async function seedDestroyingTenant(tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateRows(
    db,
    tenantTable,
    { status: "destroying", destroyStartedAt: now },
    { id: tenantId },
  );
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId,
    expectedVersion: (await loadAggregate(db, tenantId, tenantId)).at(-1)?.version ?? 0,
    type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
    payload: { startedAt: now.toString() },
    metadata: { userId: "system", requestId: "test:destruction-started" },
  });
}

async function driveDestructionToCompletion(tenantId: TenantId): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture });
    const rows = await selectMany(db, tenantTable, { id: tenantId });
    status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") break;
  }
  return status;
}

describe("inbound-mail-foundation :: tenant destroy (#3196)", () => {
  test("deletes the mail-account row for the destroyed tenant, archives its stream, leaves another tenant's row untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const accountIdA = await seedMailAccount(tenantA, "inbox-a@tenant.example");
    await seedMailAccount(tenantB, "inbox-b@tenant.example");

    await seedDestroyingTenant(tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantA.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, mailAccountsProjectionTable, { tenantId: tenantA.tenantId });
    expect(rowsA).toHaveLength(0);

    const rowsB = await selectMany(db, mailAccountsProjectionTable, { tenantId: tenantB.tenantId });
    expect(rowsB).toHaveLength(1);

    expect(await isStreamArchived(db, tenantA.tenantId, accountIdA)).toBe(true);
  });
});

// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a hand-built
// TenantDb hides the escapeHatch grant the "app-data" stage actually resolves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
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
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import {
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/feature.js";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipEntity } from "../../tenant/index.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy.js";
import { InboundMailFoundationHandlers } from "../constants.js";
import {
  seenMessageEntity,
  seenMessageTable,
  syncCursorEntity,
  syncCursorTable,
} from "../entities.js";
import { inboundMailFoundationFeature } from "../feature.js";
import { createInboundMailSupervisor, type RawInboundMessage } from "../index.js";
import {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "../projection.js";

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
// Separate tenants: destroying a tenant erases its KMS key for the whole process.
const destroyedTenant = adminFor(9103);
const survivingTenant = adminFor(9104);

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
  resetInboundInMemory();
});

async function seedTenant(user: typeof tenantA): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(ComplianceProfileHandlers.setProfile, { profileKey: "eu-dsgvo" }, user);
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

  test("also deletes inbound-message, mail-thread, sync-cursor and seen-message rows of the destroyed tenant only", async () => {
    await seedTenant(destroyedTenant);
    await seedTenant(survivingTenant);
    const accountIdA = await seedMailAccount(destroyedTenant, "inbox-a@tenant.example");
    const accountIdB = await seedMailAccount(survivingTenant, "inbox-b@tenant.example");

    // Real sync path: poll ingests the seeded messages, which writes the
    // message + thread projections, the sync cursor and the seen-message dedup rows.
    await seedInboundMessage(accountIdA, rawMessage("tenant-a-1"));
    await seedInboundMessage(accountIdB, rawMessage("tenant-b-1"));
    await createInboundMailSupervisor({
      providerCtx: { registry: stack.registry },
      db,
      dispatchWrite: ({ handlerQn, payload, tenantId }) =>
        stack.dispatcher.write(
          handlerQn,
          payload,
          createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
        ),
      pollIntervalMs: 60_000,
    }).pollOnce();

    // The supervisor's own cursor write does not persist here (it omits tenant_id),
    // so seed the cursor rows directly with their tenant.
    for (const [tenant, accountId] of [
      [destroyedTenant, accountIdA],
      [survivingTenant, accountIdB],
    ] as const) {
      await insertOne(db, syncCursorTable, {
        id: crypto.randomUUID(),
        tenantId: tenant.tenantId,
        accountId,
        scope: "inbox",
        cursor: "{}",
        updatedAt: getTemporal().Now.instant().toString(),
      });
    }

    const ownedRows = async (tenantId: TenantId, accountId: string) => ({
      messages: await selectMany(db, inboundMessagesProjectionTable, { tenantId }),
      threads: await selectMany(db, mailThreadsProjectionTable, { tenantId }),
      cursors: await selectMany(db, syncCursorTable, { accountId }),
      seen: await selectMany(db, seenMessageTable, { accountId }),
    });
    const beforeA = await ownedRows(destroyedTenant.tenantId, accountIdA);
    expect(beforeA.messages).toHaveLength(1);
    expect(beforeA.threads).toHaveLength(1);
    expect(beforeA.cursors.length).toBeGreaterThan(0);
    expect(beforeA.seen).toHaveLength(1);
    const beforeB = await ownedRows(survivingTenant.tenantId, accountIdB);

    await seedDestroyingTenant(destroyedTenant.tenantId);
    expect(await driveDestructionToCompletion(destroyedTenant.tenantId)).toBe("destroyed");

    const afterA = await ownedRows(destroyedTenant.tenantId, accountIdA);
    expect(afterA.messages).toHaveLength(0);
    expect(afterA.threads).toHaveLength(0);
    expect(afterA.cursors).toHaveLength(0);
    expect(afterA.seen).toHaveLength(0);

    const afterB = await ownedRows(survivingTenant.tenantId, accountIdB);
    expect(afterB.messages).toHaveLength(beforeB.messages.length);
    expect(afterB.threads).toHaveLength(beforeB.threads.length);
    expect(afterB.cursors).toHaveLength(beforeB.cursors.length);
    expect(afterB.seen).toHaveLength(beforeB.seen.length);
    expect(afterB.messages.length).toBeGreaterThan(0);

    const messageA = beforeA.messages[0];
    expect(await isStreamArchived(db, destroyedTenant.tenantId, String(messageA?.["id"]))).toBe(
      true,
    );
  });
});

function rawMessage(providerMessageId: string): RawInboundMessage {
  return {
    providerMessageId,
    messageIdHeader: `${providerMessageId}@example.com`,
    providerThreadId: null,
    references: [],
    from: "sender@example.com",
    to: ["inbox@tenant.example"],
    cc: [],
    subject: `Subject ${providerMessageId}`,
    snippet: "snippet",
    receivedAtIso: "2026-07-15T10:00:00Z",
    rawMime: null,
    scope: "inbox",
  };
}

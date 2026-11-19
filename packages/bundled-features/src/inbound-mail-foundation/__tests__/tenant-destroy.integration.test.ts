// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a hand-built
// TenantDb hides the escapeHatch grant the "app-data" stage actually resolves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable, isStreamArchived } from "@cosmicdrift/kumiko-framework/event-store";
import { createDistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import {
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/feature.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity } from "../../tenant/index.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  driveDestructionToCompletion,
  seedDestroyingTenant,
} from "../../tenant-lifecycle/testing.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers } from "../constants.ts";
import {
  seenMessageEntity,
  seenMessageTable,
  syncCursorEntity,
  syncCursorTable,
} from "../entities.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { createInboundMailSupervisor, type RawInboundMessage } from "../index.ts";
import { ingestFailureEntity } from "../ingest-failures.ts";
import { outboundMailSendEntity, outboundMailSendsTable } from "../outbound-send-entities.ts";
import { inboundMessagesProjectionTable, mailAccountsProjectionTable } from "../projection.ts";
import { quarantineEntity } from "../quarantine-entities.ts";
import { runInboundMailRetention } from "../retention-sweep.ts";

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
const retainedMailTenant = adminFor(9105);
const outboundSurvivingTenant = adminFor(9106);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  await unsafeCreateEntityTable(db, ingestFailureEntity);
  await unsafeCreateEntityTable(db, outboundMailSendEntity);
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

describe("inbound-mail-foundation :: tenant destroy", () => {
  test("deletes the mail-account row for the destroyed tenant, archives its stream, leaves another tenant's row untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const accountIdA = await seedMailAccount(tenantA, "inbox-a@tenant.example");
    await seedMailAccount(tenantB, "inbox-b@tenant.example");

    await seedDestroyingTenant(stack, tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(stack, db, tenantA.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, mailAccountsProjectionTable, { tenantId: tenantA.tenantId });
    expect(rowsA).toHaveLength(0);

    const rowsB = await selectMany(db, mailAccountsProjectionTable, { tenantId: tenantB.tenantId });
    expect(rowsB).toHaveLength(1);

    expect(await isStreamArchived(db, tenantA.tenantId, accountIdA)).toBe(true);
  });

  test("also deletes inbound-message, sync-cursor and seen-message rows of the destroyed tenant only", async () => {
    await seedTenant(destroyedTenant);
    await seedTenant(survivingTenant);
    const accountIdA = await seedMailAccount(destroyedTenant, "inbox-a@tenant.example");
    const accountIdB = await seedMailAccount(survivingTenant, "inbox-b@tenant.example");

    // Real sync path: poll ingests the seeded messages, which writes the
    // message projection, the sync cursor and the seen-message dedup rows.
    await seedInboundMessage(accountIdA, rawMessage("tenant-a-1"));
    await seedInboundMessage(accountIdB, rawMessage("tenant-b-1"));
    await pollOnce();

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
      cursors: await selectMany(db, syncCursorTable, { accountId }),
      seen: await selectMany(db, seenMessageTable, { accountId }),
    });
    const beforeA = await ownedRows(destroyedTenant.tenantId, accountIdA);
    expect(beforeA.messages).toHaveLength(1);
    expect(beforeA.cursors.length).toBeGreaterThan(0);
    expect(beforeA.seen).toHaveLength(1);
    const beforeB = await ownedRows(survivingTenant.tenantId, accountIdB);

    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    const messageKey = {
      kind: "record",
      entity: "inbound-message",
      id: String(beforeA.messages[0]?.["id"]),
    } as const;
    await expect(kms.getKey(messageKey, { requestId: "test" })).resolves.toBeDefined();

    await seedDestroyingTenant(stack, destroyedTenant.tenantId);
    expect(await driveDestructionToCompletion(stack, db, destroyedTenant.tenantId)).toBe(
      "destroyed",
    );

    // The subject-keys stage erases only tenant and user keys; the hook erases the record key.
    await expect(kms.getKey(messageKey, { requestId: "test" })).rejects.toThrow();

    const afterA = await ownedRows(destroyedTenant.tenantId, accountIdA);
    expect(afterA.messages).toHaveLength(0);
    expect(afterA.cursors).toHaveLength(0);
    expect(afterA.seen).toHaveLength(0);

    const afterB = await ownedRows(survivingTenant.tenantId, accountIdB);
    expect(afterB.messages).toHaveLength(beforeB.messages.length);
    expect(afterB.cursors).toHaveLength(beforeB.cursors.length);
    expect(afterB.seen).toHaveLength(beforeB.seen.length);
    expect(afterB.messages.length).toBeGreaterThan(0);

    const messageA = beforeA.messages[0];
    expect(await isStreamArchived(db, destroyedTenant.tenantId, String(messageA?.["id"]))).toBe(
      true,
    );
  });

  test("erases the record key of a mail the retention sweep already purged and deletes outbound send records", async () => {
    await seedTenant(retainedMailTenant);
    await seedTenant(outboundSurvivingTenant);
    const accountId = await seedMailAccount(retainedMailTenant, "inbox-r@tenant.example");
    const survivingAccountId = await seedMailAccount(
      outboundSurvivingTenant,
      "inbox-s@tenant.example",
    );
    await seedInboundMessage(accountId, rawMessage("retained-1"));
    await pollOnce();
    const messageId = inboundMessageAggregateId(accountId, "retained-1");

    const retention = await runInboundMailRetention({
      db,
      tenantId: retainedMailTenant.tenantId,
      now: getTemporal().Instant.from("2028-01-01T00:00:00Z"),
      seenRetentionDays: 100000,
    });
    expect(retention.messagesPurged).toBe(1);
    expect(
      await selectMany(db, inboundMessagesProjectionTable, {
        tenantId: retainedMailTenant.tenantId,
      }),
    ).toHaveLength(0);
    expect(await receivedFromOf(messageId)).toBe("sender@example.com");

    for (const [tenant, sendAccountId] of [
      [retainedMailTenant, accountId],
      [outboundSurvivingTenant, survivingAccountId],
    ] as const) {
      await insertOne(db, outboundMailSendsTable, {
        id: crypto.randomUUID(),
        tenantId: tenant.tenantId,
        idempotencyKey: "send-1",
        userId: String(tenant.id),
        accountId: sendAccountId,
        status: "sent",
        messageIdHeader: "<send-1@tenant.example>",
        claimedAt: getTemporal().Now.instant().toString(),
      });
    }

    await seedDestroyingTenant(stack, retainedMailTenant.tenantId);
    expect(await driveDestructionToCompletion(stack, db, retainedMailTenant.tenantId)).toBe(
      "destroyed",
    );

    expect(await receivedFromOf(messageId)).toBe(PII_ERASED_SENTINEL);
    expect(
      await selectMany(db, outboundMailSendsTable, { tenantId: retainedMailTenant.tenantId }),
    ).toHaveLength(0);
    expect(
      await selectMany(db, outboundMailSendsTable, { tenantId: outboundSurvivingTenant.tenantId }),
    ).toHaveLength(1);
  });
});

async function pollOnce(): Promise<void> {
  await createInboundMailSupervisor({
    lock: createDistributedLock(stack.redis.redis, "test-watch-lease:"),
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
}

async function receivedFromOf(messageId: string): Promise<unknown> {
  const kms = configuredPiiSubjectKms();
  if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
  const events = await selectMany<{ type: string; payload: { from?: string } }>(db, eventsTable, {
    aggregateId: messageId,
  });
  const received = events.find((event) => event.type.endsWith("inbound-message-received"));
  if (!received?.payload.from) throw new Error("expected a received event with a from");
  const decrypted = await decryptPiiFieldValues({ from: received.payload.from }, ["from"], kms, {
    requestId: `test:tenant-destroy-read:${messageId}`,
  });
  return decrypted["from"];
}

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

// Own stack: tenant destroy erases keys process-wide, so these tests must not share a KMS with the
// webhook tests.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createSecretsFeature } from "../../secrets/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity } from "../../tenant/index.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  driveDestructionToCompletion,
  seedDestroyingTenant,
} from "../../tenant-lifecycle/testing.ts";
import { whatsappMessageAggregateId, whatsappStatusAggregateId } from "../aggregate-id.ts";
import { WhatsappHandlers } from "../constants.ts";
import { createChannelWhatsappFeature } from "../feature.ts";
import { readWhatsappMessagePii, readWhatsappStatusPii } from "../pii.ts";
import { runWhatsappRetention, whatsappRetentionCursorEntity, whatsappRetentionCursorTable } from "../retention.ts";
import { createInMemoryMeta } from "../testing.ts";

const PHONE_NUMBER_ID = "109876543210";
const SENDER = "4915100000001";
const RECIPIENT = "4915100000002";

let stack: TestStack;
let wamidCounter = 0;

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function nextWamid(): string {
  wamidCounter += 1;
  return `wamid.retention-${wamidCounter}`;
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createChannelWhatsappFeature({ transport: createInMemoryMeta().transport }),
    ],
    masterKeyProvider,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await unsafeCreateEntityTable(stack.db, whatsappRetentionCursorEntity);
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function ingestMessage(admin: ReturnType<typeof adminFor>, wamid: string): Promise<void> {
  await stack.http.writeOk(
    WhatsappHandlers.receiveMessage,
    {
      phoneNumberId: PHONE_NUMBER_ID,
      wamid,
      from: SENDER,
      timestampIso: getTemporal().Now.instant().toString(),
      messageType: "text",
      text: "Hallo",
      buttonPayload: null,
      contextWamid: null,
      mediaId: null,
      mimeType: null,
    },
    admin,
  );
}

async function ingestStatus(admin: ReturnType<typeof adminFor>, wamid: string): Promise<void> {
  await stack.http.writeOk(
    WhatsappHandlers.recordStatus,
    {
      phoneNumberId: PHONE_NUMBER_ID,
      wamid,
      status: "delivered",
      rawStatus: null,
      timestampIso: getTemporal().Now.instant().toString(),
      recipient: RECIPIENT,
      errorCode: null,
    },
    admin,
  );
}

async function readMessage(admin: ReturnType<typeof adminFor>, wamid: string) {
  const events = await loadAggregate(
    stack.db,
    whatsappMessageAggregateId(admin.tenantId, wamid),
    admin.tenantId,
  );
  return readWhatsappMessagePii(admin.tenantId, events[0]?.payload);
}

async function readStatus(admin: ReturnType<typeof adminFor>, wamid: string) {
  const events = await loadAggregate(
    stack.db,
    whatsappStatusAggregateId(admin.tenantId, wamid, "delivered"),
    admin.tenantId,
  );
  return readWhatsappStatusPii(admin.tenantId, events[0]?.payload);
}

function retentionAt(admin: ReturnType<typeof adminFor>, offsetDays: number) {
  return runWhatsappRetention({
    db: createTenantDb({ db: stack.db, tenantId: admin.tenantId, mode: "tenant" }),
    now: getTemporal()
      .Now.instant()
      .add({ hours: offsetDays * 24 }),
  });
}

describe("channel-whatsapp retention", () => {
  test("retention keeps streams younger than 30 days readable", async () => {
    const admin = adminFor(9201);
    const wamid = nextWamid();
    await ingestMessage(admin, wamid);

    const report = await retentionAt(admin, 1);

    expect(report.streamsErased).toBe(0);
    expect((await readMessage(admin, wamid)).from).toBe(SENDER);
  });

  test("retention erases the record keys of message and status streams older than 30 days", async () => {
    const admin = adminFor(9202);
    const wamid = nextWamid();
    await ingestMessage(admin, wamid);
    await ingestStatus(admin, wamid);

    const report = await retentionAt(admin, 31);

    expect(report.streamsErased).toBe(2);
    const message = await readMessage(admin, wamid);
    expect(message.from).toBe(PII_ERASED_SENTINEL);
    expect(message.text).toBe(PII_ERASED_SENTINEL);
    expect((await readStatus(admin, wamid)).recipient).toBe(PII_ERASED_SENTINEL);

    expect((await retentionAt(admin, 31)).streamsErased).toBe(0);
  });

  test("the stream key is per stream, not the tenant key", async () => {
    const admin = adminFor(9203);
    const first = nextWamid();
    const second = nextWamid();
    await ingestMessage(admin, first);
    await ingestMessage(admin, second);

    await configuredPiiSubjectKms()?.eraseKey(
      {
        kind: "record",
        entity: "whatsapp-message",
        id: whatsappMessageAggregateId(admin.tenantId, first),
      },
      { requestId: "test" },
    );

    expect((await readMessage(admin, first)).from).toBe(PII_ERASED_SENTINEL);
    expect((await readMessage(admin, second)).from).toBe(SENDER);
  });

  test("tenant destroy erases every whatsapp stream key and the cursor row", async () => {
    const admin = adminFor(9204);
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: admin.tenantId, key: `t-${admin.tenantId}`, name: "Tenant" },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "eu-dsgvo" },
      admin,
    );
    const first = nextWamid();
    const second = nextWamid();
    await ingestMessage(admin, first);
    await retentionAt(admin, 31);
    await ingestMessage(admin, second);
    expect(
      await selectMany(stack.db, whatsappRetentionCursorTable, { tenantId: admin.tenantId }),
    ).toHaveLength(1);

    await seedDestroyingTenant(stack.db, admin.tenantId);
    const finalStatus = await driveDestructionToCompletion(stack, stack.db, admin.tenantId);

    expect(finalStatus).toBe("destroyed");
    expect((await readMessage(admin, second)).from).toBe(PII_ERASED_SENTINEL);
    expect(
      await selectMany(stack.db, whatsappRetentionCursorTable, { tenantId: admin.tenantId }),
    ).toHaveLength(0);
  });
});

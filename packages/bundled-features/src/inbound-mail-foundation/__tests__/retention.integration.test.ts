// Integration test for inbound-mail data retention. Drives real
// ingests through the dispatcher and DB (`setupTestStack`), then runs
// `runInboundMailRetention` with an injected `now`. Verifies the required scenarios:
//   - Message older than the retention period → row removed, stream archived, younger one stays
//   - Rebuild does not resurrect the purged row (the reason for `archiveStream`)
//   - Seen-anchor cleanup: past-cutoff entries removed, in-window entries stay (deduplication
//     intact)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers } from "../constants.ts";
import {
  quarantineEntity,
  seenMessageEntity,
  seenMessageTable,
  syncCursorEntity,
} from "../entities.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { runInboundMailRetention } from "../retention-sweep.ts";

let stack: TestStack;
let db: DbConnection;

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
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function connectSharedAccount(admin: ReturnType<typeof adminFor>): Promise<string> {
  const result = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team-Inbox",
      address: "inbox@tenant.example",
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

async function ingest(
  accountId: string,
  admin: ReturnType<typeof adminFor>,
  providerMessageId: string,
  receivedAtIso: string,
  bodyRef = "",
): Promise<void> {
  await stack.http.writeOk(
    InboundMailFoundationHandlers.ingestMessage,
    {
      accountId,
      ownerUserId: null,
      providerName: "inmemory",
      providerMessageId,
      messageIdHeader: `${providerMessageId}@example.com`,
      providerThreadId: null,
      references: [],
      from: "sender@example.com",
      to: ["inbox@tenant.example"],
      cc: [],
      subject: "Hello",
      snippet: "Hello world …",
      receivedAtIso,
      bodyRef,
      scope: "inbox",
      providerCursor: '{"offset":1}',
    },
    admin,
  );
}

describe("retention: inbound messages", () => {
  test("expired message purged + stream archived; younger stays; rebuild does not resurrect", async () => {
    const admin = adminFor(5001);
    const accountId = await connectSharedAccount(admin);
    await ingest(accountId, admin, "uid-old", "2024-01-01T10:00:00Z");
    await ingest(accountId, admin, "uid-young", "2026-07-01T10:00:00Z");

    const oldId = inboundMessageAggregateId(accountId, "uid-old");
    const youngId = inboundMessageAggregateId(accountId, "uid-young");
    expect(await selectMany(db, inboundMessagesProjectionTable, { accountId })).toHaveLength(2);

    // now=2026-07-13, default 365d → cutoff 2025-07-13: old(2024) expired, young(2026-07) stays.
    // Seen retention is set high so this case measures messages only.
    const now = getTemporal().Instant.from("2026-07-13T00:00:00Z");
    const report = await runInboundMailRetention({
      db,
      tenantId: admin.tenantId,
      now,
      seenRetentionDays: 100000,
    });
    expect(report.messagesPurged).toBe(1);
    expect(report.seenPurged).toBe(0);

    const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(youngId);

    // Archivierter Stream → loadAggregate leer; junger Stream intakt.
    expect(await loadAggregate(db, oldId, admin.tenantId)).toHaveLength(0);
    expect((await loadAggregate(db, youngId, admin.tenantId)).length).toBeGreaterThanOrEqual(1);

    // Rebuild does not replay `received` for the archived stream → no resurrection.
    await rebuildProjection("inbound-mail-foundation:projection:inbound-message", {
      db,
      registry: stack.registry,
    });
    const afterRebuild = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(afterRebuild).toHaveLength(1);
    expect(afterRebuild[0]?.["id"]).toBe(youngId);
  });
});

describe("retention: body-delete failure keeps the row (no orphaned storage object)", () => {
  test("deleteBodyObject throws → row + stream survive this sweep, bodyObjectErrors=1", async () => {
    const admin = adminFor(5002);
    const accountId = await connectSharedAccount(admin);
    await ingest(accountId, admin, "uid-body-fail", "2024-01-01T10:00:00Z", "body-ref-1");

    const now = getTemporal().Instant.from("2026-07-13T00:00:00Z");
    const report = await runInboundMailRetention({
      db,
      tenantId: admin.tenantId,
      now,
      seenRetentionDays: 100000,
      deleteBodyObject: async () => {
        throw new Error("storage unavailable");
      },
    });
    expect(report.messagesPurged).toBe(0);
    expect(report.bodyObjectErrors).toBe(1);

    const failId = inboundMessageAggregateId(accountId, "uid-body-fail");
    const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(rows.map((r) => r["id"])).toContain(failId);

    // The next run retries the row (now that `deleteBodyObject` works).
    const retry = await runInboundMailRetention({
      db,
      tenantId: admin.tenantId,
      now,
      seenRetentionDays: 100000,
      deleteBodyObject: async () => {},
    });
    expect(retry.messagesPurged).toBe(1);
    expect(retry.bodyObjectsDeleted).toBe(1);
    expect(await selectMany(db, inboundMessagesProjectionTable, { accountId })).toHaveLength(0);
  });
});

describe("retention: seen anchors", () => {
  test("past-cutoff anchor purged, in-window anchor stays (dedup window intact)", async () => {
    const admin = adminFor(5003);
    const accountId = await connectSharedAccount(admin);
    await ingest(accountId, admin, "uid-seen", "2026-07-01T10:00:00Z");

    const seenRows = await selectMany(db, seenMessageTable, { tenantId: admin.tenantId });
    expect(seenRows.length).toBeGreaterThanOrEqual(1);
    const seenAt = getTemporal().Instant.from(String(seenRows[0]?.["seenAt"]));

    // now = seenAt + 1 day → cutoff (now-90d) is before seenAt → nothing is due.
    const nowInWindow = seenAt.add({ hours: 24 });
    const inWindow = await runInboundMailRetention({
      db,
      tenantId: admin.tenantId,
      now: nowInWindow,
      seenRetentionDays: 90,
      messageRetentionDays: 100000,
    });
    expect(inWindow.seenPurged).toBe(0);
    expect(await selectMany(db, seenMessageTable, { tenantId: admin.tenantId })).toHaveLength(
      seenRows.length,
    );

    // now = seenAt + 91 days → cutoff (now-90d) is after seenAt → due for cleanup.
    const nowExpired = seenAt.add({ hours: 91 * 24 });
    const expired = await runInboundMailRetention({
      db,
      tenantId: admin.tenantId,
      now: nowExpired,
      seenRetentionDays: 90,
      messageRetentionDays: 100000,
    });
    expect(expired.seenPurged).toBeGreaterThanOrEqual(1);
    expect(await selectMany(db, seenMessageTable, { tenantId: admin.tenantId })).toHaveLength(0);
  });
});

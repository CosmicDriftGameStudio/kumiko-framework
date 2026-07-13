// Integration-test für inbound-mail data-retention (#957). Treibt echte
// ingests durch den Dispatcher + DB (setupTestStack), dann runInboundMailRetention
// mit injiziertem `now`. Verifiziert die Plan-Pflicht-Szenarien:
//   - Message älter als Frist → Row weg, Stream archiviert, jüngere bleibt
//   - Rebuild resurrectet die gepurgte Row NICHT (archiveStream-Rationale)
//   - Seen-Anchor-Cleanup: past-cutoff weg, in-window bleibt (Dedup intakt)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { inboundMessageAggregateId } from "../aggregate-id";
import { InboundMailFoundationHandlers } from "../constants";
import { seenMessageEntity, seenMessageTable, syncCursorEntity } from "../entities";
import { inboundMailFoundationFeature } from "../feature";
import { inboundMessagesProjectionTable } from "../projection";
import { runInboundMailRetention } from "../retention-sweep";

let stack: TestStack;
let db: DbConnection;

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
  await createEventsTable(db);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
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
      bodyRef: "",
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
    // seen weit hochgesetzt, damit dieser Fall nur die Messages misst.
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

    // Rebuild replayt received NICHT für den archivierten Stream → keine Resurrection.
    await rebuildProjection("inbound-mail-foundation:projection:inbound-message", {
      db,
      registry: stack.registry,
    });
    const afterRebuild = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(afterRebuild).toHaveLength(1);
    expect(afterRebuild[0]?.["id"]).toBe(youngId);
  });
});

describe("retention: seen anchors", () => {
  test("past-cutoff anchor purged, in-window anchor stays (dedup window intact)", async () => {
    const admin = adminFor(5002);
    const accountId = await connectSharedAccount(admin);
    await ingest(accountId, admin, "uid-seen", "2026-07-01T10:00:00Z");

    const seenRows = await selectMany(db, seenMessageTable, { tenantId: admin.tenantId });
    expect(seenRows.length).toBeGreaterThanOrEqual(1);
    const seenAt = getTemporal().Instant.from(String(seenRows[0]?.["seenAt"]));

    // now = seenAt + 1 Tag → cutoff (now-90d) liegt vor seenAt → nichts fällig.
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

    // now = seenAt + 91 Tage → cutoff (now-90d) liegt nach seenAt → fällig.
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

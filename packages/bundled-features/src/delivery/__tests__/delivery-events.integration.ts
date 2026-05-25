// Event-shape contract tests. The delivery-log is a full ES stream:
// `deliveryAttempt.<fresh-uuid>` per notify() call, event type
// `delivery:event:attempt`, schema = deliveryAttemptSchema. Projection
// tests exist elsewhere (delivery.integration.ts) — this file pins
// the event-side of the contract so a silent rename (type or
// aggregateType) fails loudly instead of breaking downstream consumers
// (MSPs, audit-feature, event-replays) who subscribe by name.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createChannelInAppFeature } from "../../channel-in-app/feature";
import { inAppMessagesTable } from "../../channel-in-app/tables";
import { createConfigFeature, createConfigResolver } from "../../config";
import { configValuesTable } from "../../config/table";
import { createTenantFeature, tenantEntity } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { DELIVERY_ATTEMPT_EVENT } from "../constants";
import { collectChannels, createDeliveryService } from "../delivery-service";
import { deliveryAttemptSchema } from "../events";
import { createDeliveryFeature } from "../feature";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables";
import type { DeliveryService } from "../types";

let stack: TestStack;
let db: DbConnection;
let deliveryService: DeliveryService;

const admin = TestUsers.admin;
const recipient = createTestUser({ id: 42, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      // In-app channel is the simplest channel to wire up — no external
      // transport needed, just writes rows to inAppMessagesTable.
      createChannelInAppFeature(),
    ],
    extraContext: { configResolver: createConfigResolver() },
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  // Events-table is auto-pushed by setupTestStack; we only need to add
  // the feature-specific projection + lookup tables here. notificationPre-
  // ferencesTable is explicit because delivery-service queries it on
  // every notify() — without it, notify() crashes before the event append.
  await unsafePushTables(db, {
    configValuesTable,
    tenantMembershipsTable,
    inAppMessagesTable,
    notificationPreferencesTable,
  });

  deliveryService = createDeliveryService({
    db,
    registry: stack.registry,
    channels: collectChannels(stack.registry),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [eventsTable, deliveryAttemptsTable]);
});

describe("delivery event shape", () => {
  test("notify() writes exactly one event per channel with correct aggregateType + type", async () => {
    await deliveryService.notify(
      "example:notify:hello",
      { to: recipient.id, data: { title: "Hallo", body: "Welt" } },
      admin,
      admin.tenantId,
    );

    const events = await selectMany(db, eventsTable, { aggregateType: "deliveryAttempt" });

    // One channel registered (in-app) → one delivery attempt → one event.
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error("expected one event");

    // Pin the canonical event-type. A rename would break MSPs + audit.
    expect(event.type).toBe(DELIVERY_ATTEMPT_EVENT);
    expect(event.type).toBe("delivery:event:attempt");
    expect(event.aggregateType).toBe("deliveryAttempt");
    expect(event.tenantId).toBe(admin.tenantId);

    // Version invariant: each delivery attempt spawns a FRESH aggregate-id
    // (see logDelivery → generateId()), so the event is always the first
    // event on its stream → version 1. If this ever fails, the design
    // changed — e.g. retries share an aggregate — and downstream replay /
    // version-ordering logic needs to be revisited.
    expect(event.version).toBe(1);
  });

  test("event payload round-trips through deliveryAttemptSchema", async () => {
    await deliveryService.notify(
      "example:notify:schema-check",
      { to: recipient.id, data: { title: "T", body: "B" } },
      admin,
      admin.tenantId,
    );

    const [event] = await selectMany(db, eventsTable, { aggregateType: "deliveryAttempt" });
    if (!event) throw new Error("expected one event");

    // The service schema-parses before append (see logDelivery), but we
    // also verify the stored row still matches — catches a drift between
    // what the service writes and what downstream consumers can re-parse.
    const parsed = deliveryAttemptSchema.parse(event.payload);
    expect(parsed.notificationType).toBe("example:notify:schema-check");
    expect(parsed.channel).toBe("inApp");
    expect(parsed.recipientId).toBe(recipient.id);
    expect(parsed.status).toBe("sent");
  });

  test("projection row PK equals event aggregateId", async () => {
    await deliveryService.notify(
      "example:notify:pk-link",
      { to: recipient.id, data: { title: "T", body: "B" } },
      admin,
      admin.tenantId,
    );

    const [event] = await selectMany(db, eventsTable, { aggregateType: "deliveryAttempt" });
    if (!event) throw new Error("expected one event");

    // PK is unique — a matching row on `id === aggregateId` is already the
    // contract; no secondary filter needed. Same convention as jobRunsTable
    // + tenantSecretsTable: projection-row PK IS the event aggregateId, so
    // a replay of the same event conflicts on the PK rather than
    // duplicating the log row.
    const [row] = await selectMany(db, deliveryAttemptsTable, { id: event.aggregateId });
    expect(row).toBeDefined();
    expect(row?.notificationType).toBe("example:notify:pk-link");
  });
});

// Event-shape contract tests. The delivery-log is a full ES stream:
// `deliveryAttempt.<fresh-uuid>` per notify() call, event type
// `delivery:event:attempt`, schema = deliveryAttemptSchema. Projection
// tests exist elsewhere (delivery.integration.ts) — this file pins
// the event-side of the contract so a silent rename (type or
// aggregateType) fails loudly instead of breaking downstream consumers
// (MSPs, audit-feature, event-replays) who subscribe by name.

import type { DbConnection } from "@kumiko/framework/db";
import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createChannelInAppFeature } from "../../channel-in-app/channel-in-app-feature";
import { inAppMessagesTable } from "../../channel-in-app/tables";
import { createConfigFeature, createConfigResolver } from "../../config";
import { configValuesTable } from "../../config/table";
import { createTenantFeature, tenantEntity } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { DELIVERY_ATTEMPT_EVENT } from "../constants";
import { createDeliveryFeature } from "../delivery-feature";
import { deliveryAttemptSchema } from "../delivery-feature-schemas";
import { collectChannels, createDeliveryService } from "../delivery-service";
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
  db = stack.db.db;
  await createEntityTable(db, tenantEntity);
  await pushTables(db, {
    configValuesTable,
    tenantMembershipsTable,
    inAppMessagesTable,
    // Needed because delivery-service's preference-check queries it on every
    // notify() — without the table the notify() itself crashes before any
    // event gets appended.
    notificationPreferencesTable,
  });
  await createEventsTable(db);

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
  // Fresh state per test so event-count assertions are deterministic.
  await db.delete(eventsTable);
  await db.delete(deliveryAttemptsTable);
});

describe("delivery event shape", () => {
  test("notify() writes exactly one event per channel with correct aggregateType + type", async () => {
    await deliveryService.notify(
      "example:notify:hello",
      { to: recipient.id, data: { title: "Hallo", body: "Welt" } },
      admin,
      admin.tenantId,
    );

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "deliveryAttempt"));

    // One channel registered (in-app) → one delivery attempt → one event.
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error("expected one event");

    // Pin the canonical event-type. A rename would break MSPs + audit.
    expect(event.type).toBe(DELIVERY_ATTEMPT_EVENT);
    expect(event.type).toBe("delivery:event:attempt");
    expect(event.aggregateType).toBe("deliveryAttempt");
    expect(event.tenantId).toBe(admin.tenantId);

    // Every attempt is its own aggregate-stream — first event in each stream
    // is version 1.
    expect(event.version).toBe(1);
  });

  test("event payload round-trips through deliveryAttemptSchema", async () => {
    await deliveryService.notify(
      "example:notify:schema-check",
      { to: recipient.id, data: { title: "T", body: "B" } },
      admin,
      admin.tenantId,
    );

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "deliveryAttempt"));
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

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "deliveryAttempt"));
    if (!event) throw new Error("expected one event");

    const [row] = await db
      .select()
      .from(deliveryAttemptsTable)
      .where(
        and(
          eq(deliveryAttemptsTable.id, event.aggregateId),
          eq(deliveryAttemptsTable.notificationType, "example:notify:pk-link"),
        ),
      );
    expect(row).toBeDefined();
    // Same convention as jobRunsTable + tenantSecretsTable: projection-row
    // PK IS the event aggregateId. Replaying the same event conflicts on
    // the PK rather than duplicating the log row.
    expect(row?.id).toBe(event.aggregateId);
  });
});

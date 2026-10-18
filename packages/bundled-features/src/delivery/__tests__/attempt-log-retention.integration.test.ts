import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { ConsumerLagError } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelInAppFeature } from "../../channel-in-app/feature.ts";
import { inAppMessagesTable } from "../../channel-in-app/tables.ts";
import { createConfigFeature, createConfigResolver } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature, tenantEntity } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { runAttemptLogRetention } from "../attempt-log-retention.ts";
import { collectChannels, createDeliveryService } from "../delivery-service.ts";
import { createDeliveryFeature } from "../feature.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables.ts";
import type { DeliveryService } from "../types.ts";

let stack: TestStack;
let db: DbConnection;
let deliveryService: DeliveryService;

const admin = TestUsers.admin;
const ONE_DAY_HOURS = 24;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelInAppFeature(),
    ],
    extraContext: { configResolver: createConfigResolver() },
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
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

async function notifyTwice(): Promise<void> {
  for (const notificationType of ["example:notify:first", "example:notify:second"]) {
    await deliveryService.notify(
      notificationType,
      { to: admin.id, data: { title: "T", body: "B" } },
      admin,
      admin.tenantId,
    );
  }
}

// Event consumers (e.g. the SSE broadcast) must have processed the attempts before they may be pruned.
async function letConsumersCatchUp(): Promise<void> {
  await stack.eventDispatcher?.runOnce();
}

async function attemptCounts(): Promise<{ events: number; rows: number }> {
  const events = await selectMany(db, eventsTable, { aggregateType: "deliveryAttempt" });
  const rows = await selectMany(db, deliveryAttemptsTable, {});
  return { events: events.length, rows: rows.length };
}

describe("runAttemptLogRetention", () => {
  test("keeps attempts younger than the cutoff", async () => {
    await notifyTwice();

    const result = await runAttemptLogRetention(db, { olderThanDays: 90 });

    expect(result).toEqual({ deletedEvents: 0, deletedRows: 0 });
    expect(await attemptCounts()).toEqual({ events: 2, rows: 2 });
  });

  test("prunes attempt events and projection rows older than the cutoff", async () => {
    await notifyTwice();
    await letConsumersCatchUp();
    const tomorrow = Temporal.Now.instant().add({ hours: ONE_DAY_HOURS });

    const result = await runAttemptLogRetention(db, { olderThan: tomorrow });

    expect(result).toEqual({ deletedEvents: 2, deletedRows: 2 });
    expect(await attemptCounts()).toEqual({ events: 0, rows: 0 });
  });

  test("refuses to prune while an event consumer lags and deletes nothing", async () => {
    await notifyTwice();
    const tomorrow = Temporal.Now.instant().add({ hours: ONE_DAY_HOURS });

    await expect(runAttemptLogRetention(db, { olderThan: tomorrow })).rejects.toThrow(
      ConsumerLagError,
    );
    expect(await attemptCounts()).toEqual({ events: 2, rows: 2 });
  });
});

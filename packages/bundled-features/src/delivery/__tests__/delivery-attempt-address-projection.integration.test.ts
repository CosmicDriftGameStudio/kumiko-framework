import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
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
import { DELIVERY_ATTEMPT_EVENT } from "../constants.ts";
import { createDeliveryFeature } from "../feature.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables.ts";

let stack: TestStack;
const admin = TestUsers.admin;

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
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    inAppMessagesTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable, deliveryAttemptsTable]);
});

async function appendAttempt(channel: string, recipientAddress: string | null): Promise<string> {
  const aggregateId = crypto.randomUUID();
  await append(stack.db, {
    aggregateId,
    aggregateType: "deliveryAttempt",
    tenantId: admin.tenantId,
    expectedVersion: 0,
    type: DELIVERY_ATTEMPT_EVENT,
    payload: {
      notificationType: "example:notify",
      channel,
      recipientId: null,
      recipientAddress,
      status: "sent",
      error: null,
      priority: "normal",
    },
    metadata: { userId: "system" },
  });
  return aggregateId;
}

async function projectedAddress(aggregateId: string): Promise<string | null | undefined> {
  const rows = await selectMany(stack.db, deliveryAttemptsTable, { id: aggregateId });
  return rows[0]?.recipientAddress;
}

describe("delivery-log projection masks the recipient address", () => {
  test("a legacy event with a full address is masked by the rebuild", async () => {
    const id = await appendAttempt("email", "jane.doe@example.com");

    await rebuildProjection("delivery:projection:delivery-log", {
      db: stack.db,
      registry: stack.registry,
    });

    expect(await projectedAddress(id)).toBe("j***@example.com");
  });

  test("an already masked address stays unchanged", async () => {
    const id = await appendAttempt("email", "j***@example.com");

    await rebuildProjection("delivery:projection:delivery-log", {
      db: stack.db,
      registry: stack.registry,
    });

    expect(await projectedAddress(id)).toBe("j***@example.com");
  });

  test("a null address stays null", async () => {
    const id = await appendAttempt("email", null);

    await rebuildProjection("delivery:projection:delivery-log", {
      db: stack.db,
      registry: stack.registry,
    });

    expect(await projectedAddress(id)).toBeNull();
  });
});

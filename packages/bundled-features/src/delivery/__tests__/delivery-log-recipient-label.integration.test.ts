// delivery:query:log recipientLabel: display name, else decrypted address, else
// recipientId. Real stack, real HTTP; rows seeded straight into the projection table.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity } from "../../user/schema/user.js";
import { seedUser } from "../../user/seeding.js";
import { DeliveryQueries } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { deliveryAttemptsTable } from "../tables.js";

type LabelRow = {
  readonly type: string;
  readonly recipient: string | null;
  readonly recipientLabel: string | null;
};

const tenantId = testTenantId(711);
const admin = createTestUser({ id: 711, roles: ["TenantAdmin"], tenantId });
const UNKNOWN_USER_ID = "7a1d2c3e-0000-4000-8000-000000000001";

async function attempt(
  stack: TestStack,
  notificationType: string,
  recipientId: string | null,
  recipientAddress: string | null,
): Promise<void> {
  await insertMany(stack.db, deliveryAttemptsTable, [
    {
      id: crypto.randomUUID(),
      tenantId,
      notificationType,
      channel: "email",
      recipientId,
      recipientAddress,
      status: "sent",
    },
  ]);
}

async function labelsByType(stack: TestStack): Promise<Record<string, LabelRow>> {
  const result = await stack.http.queryOk<{ rows: readonly LabelRow[] }>(
    DeliveryQueries.log,
    { limit: 50 },
    admin,
  );
  return Object.fromEntries(result.rows.map((row) => [row.type, row]));
}

describe("delivery:query:log recipientLabel with the user feature", () => {
  let stack: TestStack;
  let userId: string;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createDeliveryFeature(),
      ],
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
    await unsafePushTables(stack.db, { configValuesTable, deliveryAttemptsTable });
    ({ id: userId } = await seedUser(stack.db, {
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      emailVerified: true,
    }));
    await attempt(stack, "label:known-a", userId, "ada@example.com");
    await attempt(stack, "label:known-b", userId, null);
    await attempt(stack, "label:direct", null, "direct@example.com");
    await attempt(stack, "label:unknown", UNKNOWN_USER_ID, null);
    await attempt(stack, "label:non-uuid", "not-a-uuid", null);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a known user shows the display name, also when the address is present", async () => {
    const rows = await labelsByType(stack);
    expect(rows["label:known-a"]?.recipientLabel).toBe("Ada Lovelace");
    expect(rows["label:known-b"]?.recipientLabel).toBe("Ada Lovelace");
  });

  test("a direct address without recipientId shows the address", async () => {
    const rows = await labelsByType(stack);
    expect(rows["label:direct"]?.recipientLabel).toBe("direct@example.com");
  });

  test("an unknown recipientId falls back to the id, a non-uuid id does not break the page", async () => {
    const rows = await labelsByType(stack);
    expect(rows["label:unknown"]?.recipientLabel).toBe(UNKNOWN_USER_ID);
    expect(rows["label:non-uuid"]?.recipientLabel).toBe("not-a-uuid");
  });
});

describe("delivery:query:log recipientLabel without the user feature", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [createConfigFeature(), createTenantFeature(), createDeliveryFeature()],
    });
    await unsafePushTables(stack.db, { configValuesTable, deliveryAttemptsTable });
    await attempt(stack, "label:with-address", crypto.randomUUID(), "someone@example.com");
    await attempt(stack, "label:id-only", UNKNOWN_USER_ID, null);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("falls back to the address, then the id, without error", async () => {
    const rows = await labelsByType(stack);
    expect(rows["label:with-address"]?.recipientLabel).toBe("someone@example.com");
    expect(rows["label:id-only"]?.recipientLabel).toBe(UNKNOWN_USER_ID);
  });
});

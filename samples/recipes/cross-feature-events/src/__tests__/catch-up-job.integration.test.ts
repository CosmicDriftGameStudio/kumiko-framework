// The invoice-order job is triggered by the order-placed event with catchUp: it runs once per
// stored event, including orders that were placed before the dispatcher ever looked at the store.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { invoicedOrderIds, orderEntity, pubsubOrderFeature } from "../feature";

let stack: TestStack;

const customer = createTestUser({ roles: ["Customer"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [pubsubOrderFeature],
    jobs: { consumerLane: "worker", queueNamePrefix: `cross-feature-events-${generateId()}` },
  });
  await unsafeCreateEntityTable(stack.db, orderEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function placeOrder(customerName: string): Promise<string> {
  const data = await stack.http.writeOk(
    "pubsub-orders:write:order:place",
    { customer: customerName, product: "Widget" },
    customer,
  );
  return String(data["id"]);
}

describe("r.job with trigger catchUp", () => {
  test("invoices every placed order exactly once, older ones included", async () => {
    const earlier = [await placeOrder("Erin"), await placeOrder("Frank")];

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      await stack.drainJobs();
      expect(invoicedOrderIds.slice().sort()).toEqual(earlier.slice().sort());
    });

    const later = await placeOrder("Grace");
    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      await stack.drainJobs();
      expect(invoicedOrderIds).toContain(later);
    });
    expect(invoicedOrderIds).toHaveLength(3);
  });
});

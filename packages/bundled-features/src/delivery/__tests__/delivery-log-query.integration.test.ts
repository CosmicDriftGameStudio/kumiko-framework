// delivery:query:log — PagedRows contract, real sort, sort-whitelist
// fallback, and the notificationType/recipientAddress → type/recipient
// field-mapping the query handler now owns (see log.query.ts).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { DeliveryQueries } from "../constants";
import { createDeliveryFeature } from "../feature";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables";

type LogRow = {
  readonly id: string;
  readonly type: string;
  readonly channel: string;
  readonly recipient: string | null;
  readonly status: string;
};

let stack: TestStack;
const tenantId = testTenantId(701);
const admin = createTestUser({ id: 701, roles: ["TenantAdmin"], tenantId });

beforeAll(async () => {
  stack = await setupTestStack({ features: [createDeliveryFeature()] });
  await unsafePushTables(stack.db, { deliveryAttemptsTable, notificationPreferencesTable });
  await insertMany(stack.db, deliveryAttemptsTable, [
    {
      id: crypto.randomUUID(),
      tenantId,
      notificationType: "logtest:alpha",
      channel: "email",
      recipientAddress: "alpha@example.com",
      status: "sent",
    },
    {
      id: crypto.randomUUID(),
      tenantId,
      notificationType: "logtest:beta",
      channel: "push",
      recipientAddress: "beta@example.com",
      status: "failed",
    },
    {
      id: crypto.randomUUID(),
      tenantId,
      notificationType: "logtest:gamma",
      channel: "inApp",
      recipientAddress: null,
      status: "queued",
    },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("delivery:query:log — PagedRows contract", () => {
  test("a full page carries a nextCursor; the following (partial) page does not", async () => {
    const first = await stack.http.queryOk<{
      rows: readonly LogRow[];
      nextCursor: string | null;
    }>(DeliveryQueries.log, { limit: 2, sort: "type", sortDirection: "asc" }, admin);
    expect(first.rows.map((r) => r.type)).toEqual(["logtest:alpha", "logtest:beta"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await stack.http.queryOk<{
      rows: readonly LogRow[];
      nextCursor: string | null;
    }>(
      DeliveryQueries.log,
      { limit: 2, sort: "type", sortDirection: "asc", cursor: first.nextCursor ?? undefined },
      admin,
    );
    expect(second.rows.map((r) => r.type)).toEqual(["logtest:gamma"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("delivery:query:log — sort", () => {
  test("asc vs desc on the same whitelisted field actually reverses row order", async () => {
    const asc = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      { sort: "type", sortDirection: "asc" },
      admin,
    );
    const desc = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      { sort: "type", sortDirection: "desc" },
      admin,
    );
    const ascTypes = asc.rows.map((r) => r.type);
    const descTypes = desc.rows.map((r) => r.type);
    expect(ascTypes).toEqual(["logtest:alpha", "logtest:beta", "logtest:gamma"]);
    expect(descTypes).toEqual([...ascTypes].reverse());
  });

  test("a sort field outside the whitelist falls back to the default order, not an ad-hoc SQL column", async () => {
    const withInvalidSort = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      { sort: "recipient" },
      admin,
    );
    const withNoSort = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      {},
      admin,
    );
    expect(withInvalidSort.rows.map((r) => r.id)).toEqual(withNoSort.rows.map((r) => r.id));
  });
});

describe("delivery:query:log — field mapping", () => {
  test("rows carry type/recipient (display names), not the raw notificationType/recipientAddress column names", async () => {
    const result = await stack.http.queryOk<{ rows: readonly Record<string, unknown>[] }>(
      DeliveryQueries.log,
      { sort: "type", sortDirection: "asc" },
      admin,
    );
    const alpha = result.rows.find((r) => r["type"] === "logtest:alpha");
    expect(alpha?.["recipient"]).toBe("alpha@example.com");
    expect(alpha).not.toHaveProperty("notificationType");
    expect(alpha).not.toHaveProperty("recipientAddress");
  });
});

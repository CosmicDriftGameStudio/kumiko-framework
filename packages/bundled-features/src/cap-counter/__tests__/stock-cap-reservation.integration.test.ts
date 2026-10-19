// Two parallel writes at an empty tenant with limit 1 must not both pass the stock-cap check:
// withStockCap serialises count-then-write per tenant and cap with an advisory xact lock.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineFeature,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { capCounterEntity } from "../entity.ts";
import { createStockCapGuard } from "../stock-cap-guard.ts";

const { executor, table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

const CAP_CODE = "stock_reservation_exceeded";
const CAP_NAME = "reservation-item";

const guard = createStockCapGuard(async () => ({ maxItems: 1 }));

// Widens the gap between the guard's count and the insert: without the advisory lock both
// parallel requests count 0 inside this window and both insert, so the test fails.
const RACE_WINDOW_MS = 150;

const createItemHandler: WriteHandlerDef = {
  name: "create-item",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    await Bun.sleep(RACE_WINDOW_MS);
    return executor.create(
      {
        tenantId: event.user.tenantId,
        capName: CAP_NAME,
        value: 0,
        periodStart: "2026-07-01T00:00:00Z",
      },
      event.user,
      ctx.db,
    );
  },
};

const reservationFeature = defineFeature("stock-reservation", (r) => {
  r.writeHandler(
    guard.withStockCap(createItemHandler, {
      table: capCounterTable,
      limit: (caps: { maxItems: number }) => caps.maxItems,
      where: { capName: CAP_NAME },
      code: CAP_CODE,
      i18nKey: "cap.stock-exceeded",
      field: "capName",
    }),
  );
});

const CREATE_QN = "stock-reservation:write:create-item";

describe("withStockCap reservation", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [reservationFeature] });
    await unsafeCreateEntityTable(stack.db, capCounterEntity, "cap-counter");
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [capCounterTable, eventsTable]);
  });

  const admin = (tenantNumber: number) =>
    createTestUser({
      id: tenantNumber,
      tenantId: testTenantId(tenantNumber),
      roles: ["TenantAdmin"],
    });

  const rowCount = (tenantNumber: number) =>
    createTenantDb({ db: stack.db, tenantId: testTenantId(tenantNumber) }).count(capCounterTable, {
      capName: CAP_NAME,
    });

  test("two parallel writes at limit 1: exactly one succeeds, the other gets the cap failure", async () => {
    const user = admin(3201);

    const responses = await Promise.all([
      stack.http.write(CREATE_QN, {}, user),
      stack.http.write(CREATE_QN, {}, user),
    ]);

    const statuses = responses.map((res) => res.status).sort();
    expect(statuses.filter((status) => status >= 200 && status < 300)).toHaveLength(1);
    expect(statuses.filter((status) => status === 422)).toHaveLength(1);
    const rejected = responses.find((res) => res.status === 422);
    expect(JSON.stringify(await rejected?.json())).toContain(CAP_CODE);
    expect(await rowCount(3201)).toBe(1);
  });

  test("sequential writes: the second is rejected with current 1 / limit 1", async () => {
    const user = admin(3202);

    await stack.http.writeOk(CREATE_QN, {}, user);
    const error = await stack.http.writeErr(CREATE_QN, {}, user);

    expect(error.httpStatus).toBe(422);
    expect(error.details).toMatchObject({ reason: CAP_CODE, current: 1, limit: 1 });
    expect(await rowCount(3202)).toBe(1);
  });
});

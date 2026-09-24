// A provably-idle consumer's doPass turn must not take the state row's
// FOR UPDATE SKIP LOCKED lock: that lock sets xmax on the row, requires an
// xid, writes WAL, and forces a commit fsync — on every poll tick, forever,
// even with zero events in the system. The pre-check in
// selectIdleConsumerKeys (event-dispatcher-delivery.ts) must keep an idle
// consumer's row untouched entirely, verified here via the row's own
// system column `xmax`: unchanged across an idle runOnce() means no lock
// was ever taken on it.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";
import { SHARED_INSTANCE_SENTINEL } from "../event-consumer-state";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

let observed: Array<{ name: string }> = [];

const idleFeature = defineFeature("idletest", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async (event) => {
        observed.push({ name: event.payload["name"] as string });
      },
    },
  });
});

const admin = TestUsers.admin;
const qn = "idletest:projection:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [idleFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  observed = [];
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

async function readConsumerRowXmax(): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT xmax::text FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2`,
    [qn, SHARED_INSTANCE_SENTINEL],
  )) as ReadonlyArray<{ xmax: string }>;
  const xmax = rows[0]?.xmax;
  if (xmax === undefined) throw new Error("consumer state row missing");
  return xmax;
}

describe("idle event-dispatcher passes take no row lock", () => {
  test("xmax is unchanged across an idle runOnce() after draining, then a new event is still delivered", async () => {
    await appendWidget("drain-me");
    await stack.eventDispatcher?.runOnce();
    expect(observed).toEqual([{ name: "drain-me" }]);

    const xmaxBeforeIdlePass = await readConsumerRowXmax();

    await stack.eventDispatcher?.runOnce();
    const xmaxAfterIdlePass = await readConsumerRowXmax();
    expect(xmaxAfterIdlePass).toBe(xmaxBeforeIdlePass);

    await appendWidget("wake-me");
    const result = await stack.eventDispatcher?.runOnce();
    expect(result?.processed).toBeGreaterThan(0);
    expect(observed).toEqual([{ name: "drain-me" }, { name: "wake-me" }]);
  });
});

// ctx.notify in a write handler must not touch the app pool while the handler's
// transaction holds a slot (pool exhaustion deadlock) and must not outlive a
// rolled-back write. Deferred delivery runs after commit; immediate: true runs
// inside the write on the outside-tx pool.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  type NotifyResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createChannelInAppFeature } from "../../channel-in-app/feature.ts";
import { inAppMessagesTable } from "../../channel-in-app/tables.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { TenantQueries } from "../../tenant/constants.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { createDeliveryFeature } from "../feature.ts";
import { createDeliveryTestContext } from "../testing.ts";

const POOL_MAX = 2;
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const tenantUsers = [10, 11, 12].map((id) => createTestUser({ id, roles: ["User"] }));
const caller = TestUsers.admin;

function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) release();
    return allArrived;
  };
}

let waitForAllWrites = createBarrier(POOL_MAX);
const queuedSends: string[] = [];

const queuedChannelFeature = defineFeature("queued-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "queuedProbe", {
    mode: "queued",
    send: async (address) => {
      queuedSends.push(address);
      return { status: "sent" };
    },
  });
});

const probeFeature = defineFeature("after-commit-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.writeHandler(
    defineWriteHandler({
      name: "broadcast",
      schema: z.object({
        type: z.string(),
        immediate: z.boolean().optional(),
        failAfterNotify: z.boolean().optional(),
        holdTransaction: z.boolean().optional(),
        toTenant: z.string().optional(),
      }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        if (event.payload.holdTransaction) await waitForAllWrites();
        const notify = ctx.notify as NotifyFn;
        const result = await notify(event.payload.type, {
          to: { tenant: event.payload.toTenant ?? TENANT_ID },
          data: { title: event.payload.type },
          ...(event.payload.immediate && { immediate: true }),
        });
        if (event.payload.failAfterNotify) throw new Error("handler failed after notify");
        return { isSuccess: true, data: result };
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "notify-route",
      schema: z.object({ type: z.string(), failAfterNotify: z.boolean() }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(event.payload.type, {
          route: { queuedProbe: event.payload.type },
          data: { title: event.payload.type },
        });
        if (event.payload.failAfterNotify) throw new Error("handler failed after notify");
        return { isSuccess: true, data: { done: true } };
      },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelInAppFeature(),
      queuedChannelFeature,
      probeFeature,
    ],
    dbPoolMax: POOL_MAX,
    outsideTransactionPoolMax: POOL_MAX,
    jobs: { consumerLane: "worker" },
    extraContext: (deps) =>
      createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
  });
  await unsafePushTables(stack.db, { tenantMembershipsTable, inAppMessagesTable });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await stack.http.writeOk(
    "tenant:write:create",
    { key: "test", name: "Test Tenant" },
    TestUsers.systemAdmin,
  );
  for (const user of tenantUsers) {
    await stack.http.writeOk(
      "tenant:write:add-member",
      { userId: user.id, tenantId: TENANT_ID, roles: ["User"] },
      createSystemUser(TestUsers.systemAdmin.tenantId, ["SystemAdmin"]),
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

async function inboxTitlesOf(userId: string, type: string): Promise<string[]> {
  const rows = await selectMany<{ title: string }>(stack.db, inAppMessagesTable, {
    userId,
    notificationType: type,
  });
  return rows.map((row) => row.title);
}

async function attemptEventsFor(type: string) {
  const events = await selectMany(stack.db, eventsTable, { aggregateType: "deliveryAttempt" });
  return events.filter((event) => JSON.stringify(event.payload).includes(type));
}

describe("ctx.notify in write handlers with an exhausted app pool", () => {
  test("deferred broadcasts from parallel writes all complete and reach every tenant user", async () => {
    waitForAllWrites = createBarrier(POOL_MAX);
    const type = "app:notify:pool-deferred";

    const responses = await Promise.all(
      Array.from({ length: POOL_MAX }, () =>
        stack.http.write(
          "after-commit-probe:write:broadcast",
          { type, holdTransaction: true },
          caller,
        ),
      ),
    );

    for (const res of responses) {
      const body = (await res.json()) as { isSuccess: boolean; data: NotifyResult };
      expect(body.isSuccess).toBe(true);
      expect(body.data).toEqual({ kind: "deferred" });
    }
    for (const user of tenantUsers) {
      expect(await inboxTitlesOf(user.id, type)).toEqual(Array(POOL_MAX).fill(type));
    }
  });

  test("immediate broadcasts run on the outside-tx pool without hanging", async () => {
    waitForAllWrites = createBarrier(POOL_MAX);
    const type = "app:notify:pool-immediate";

    const responses = await Promise.all(
      Array.from({ length: POOL_MAX }, () =>
        stack.http.write(
          "after-commit-probe:write:broadcast",
          { type, immediate: true, holdTransaction: true },
          caller,
        ),
      ),
    );

    for (const res of responses) {
      const body = (await res.json()) as { isSuccess: boolean; data: NotifyResult };
      expect(body.isSuccess).toBe(true);
      if (body.data.kind !== "dispatched") throw new Error("immediate notify must be dispatched");
      expect(body.data.deliveries.map((d) => d.recipientId).sort()).toEqual(
        tenantUsers.map((user) => user.id).sort(),
      );
      expect(body.data.deliveries.every((d) => d.status === "sent")).toBe(true);
    }
    for (const user of tenantUsers) {
      expect(await inboxTitlesOf(user.id, type)).toEqual(Array(POOL_MAX).fill(type));
    }
  });
});

describe("ctx.notify tenant scope", () => {
  const foreignTenant = "00000000-0000-4000-8000-0000000000ff";

  test.each([
    { mode: "deferred", immediate: false },
    { mode: "immediate", immediate: true },
  ])("a $mode broadcast to another tenant fails the write synchronously", async ({ immediate }) => {
    const type = `app:notify:foreign-${immediate ? "immediate" : "deferred"}`;

    const res = await stack.http.write(
      "after-commit-probe:write:broadcast",
      { type, immediate, toTenant: foreignTenant },
      caller,
    );

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("notify_foreign_tenant_broadcast");
    expect(await attemptEventsFor(type)).toHaveLength(0);
  });

  test("a broadcast to the caller's own tenant is delivered", async () => {
    const type = "app:notify:own-tenant";

    await stack.http.writeOk(
      "after-commit-probe:write:broadcast",
      { type, toTenant: TENANT_ID },
      caller,
    );

    for (const user of tenantUsers) {
      expect(await inboxTitlesOf(user.id, type)).toEqual([type]);
    }
  });
});

describe("ctx.notify and handler rollback", () => {
  test("a rolled-back write leaves no attempt event or job, a committed one leaves both", async () => {
    const rolledBackType = "app:notify:rolled-back";
    const committedType = "app:notify:committed";
    queuedSends.length = 0;

    const res = await stack.http.write(
      "after-commit-probe:write:notify-route",
      { type: rolledBackType, failAfterNotify: true },
      caller,
    );
    expect((await res.json()).isSuccess).toBe(false);
    await stack.http.writeOk(
      "after-commit-probe:write:notify-route",
      { type: committedType, failAfterNotify: false },
      caller,
    );

    expect(await attemptEventsFor(rolledBackType)).toHaveLength(0);
    expect((await attemptEventsFor(committedType)).length).toBeGreaterThan(0);
    // A job of the rolled-back write was enqueued first, so it would have run by now.
    await waitFor(() => expect(queuedSends).toContain(committedType));
    expect(queuedSends).not.toContain(rolledBackType);
  });

  test("a rolled-back broadcast writes no inbox message", async () => {
    const type = "app:notify:rolled-back-broadcast";

    const res = await stack.http.write(
      "after-commit-probe:write:broadcast",
      { type, failAfterNotify: true },
      caller,
    );
    expect((await res.json()).isSuccess).toBe(false);

    for (const user of tenantUsers) {
      expect(await inboxTitlesOf(user.id, type)).not.toContain(type);
    }
  });
});
